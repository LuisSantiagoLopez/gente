package com.deskhead.gente.billing

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.deskhead.gente.net.CloudApi
import com.deskhead.gente.net.CloudException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** Play product ids. Must match Play Console and Gente Cloud's /v1/billing/play/verify. */
object Products {
    const val PRO = "gente_pro" // base plans: pro-month ($20), pro-year ($204)
    const val MAX = "gente_max" // base plan: max-month ($100)
    const val MAX_PLUS = "gente_max_plus" // base plan: max-plus-month ($200)
    const val HOURS_8 = "gente_hours_8" // consumable, 8 online hours ($5)
    val SUBS = listOf(PRO, MAX, MAX_PLUS)
    val INAPP = listOf(HOURS_8)
}

data class Offer(val productId: String, val basePlanId: String?, val title: String, val price: String, val period: String?, val offerToken: String?, val details: ProductDetails)

sealed interface PurchaseState {
    data object Idle : PurchaseState
    data object Working : PurchaseState
    data class Confirmed(val productId: String) : PurchaseState
    /** Paid in Play but our server has not confirmed yet. Retried on every start; never lost. */
    data class Pending(val productId: String) : PurchaseState
    data class Failed(val code: String) : PurchaseState
}

/**
 * Google Play Billing for digital goods (plans and hour packs). Stripe is not used inside the
 * Android app. Every purchase is verified by Gente Cloud with the Play Developer API before the
 * plan or hours are granted; the server acknowledges subscriptions, the app consumes hour packs
 * only after the server granted them.
 */
class PlayBilling(context: Context, private val cloud: CloudApi, private val scope: CoroutineScope) : PurchasesUpdatedListener {
    private val _offers = MutableStateFlow<List<Offer>>(emptyList())
    val offers: StateFlow<List<Offer>> = _offers
    private val _state = MutableStateFlow<PurchaseState>(PurchaseState.Idle)
    val state: StateFlow<PurchaseState> = _state

    private val client: BillingClient = BillingClient.newBuilder(context)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    fun connect() {
        if (client.isReady) { refresh(); return }
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) { if (result.responseCode == BillingClient.BillingResponseCode.OK) refresh() }
            override fun onBillingServiceDisconnected() {}
        })
    }

    private fun refresh() {
        scope.launch {
            val subs = query(Products.SUBS, BillingClient.ProductType.SUBS)
            val inapp = query(Products.INAPP, BillingClient.ProductType.INAPP)
            _offers.value = subs.flatMap { d ->
                d.subscriptionOfferDetails.orEmpty().filter { it.offerId == null }.map { o ->
                    val phase = o.pricingPhases.pricingPhaseList.last()
                    Offer(d.productId, o.basePlanId, d.name, phase.formattedPrice, phase.billingPeriod, o.offerToken, d)
                }
            } + inapp.map { d -> Offer(d.productId, null, d.name, d.oneTimePurchaseOfferDetails?.formattedPrice.orEmpty(), null, null, d) }
            restore()
        }
    }

    private suspend fun query(ids: List<String>, type: String): List<ProductDetails> = suspendCancellableCoroutine { cont ->
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(ids.map { QueryProductDetailsParams.Product.newBuilder().setProductId(it).setProductType(type).build() })
            .build()
        client.queryProductDetailsAsync(params) { _, result -> cont.resume(result.productDetailsList) }
    }

    /** Re-sends any purchase the server has not confirmed (app killed mid-purchase, offline, etc.). */
    private fun restore() {
        listOf(BillingClient.ProductType.SUBS, BillingClient.ProductType.INAPP).forEach { type ->
            client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(type).build()) { _, list ->
                list.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED && (!it.isAcknowledged || type == BillingClient.ProductType.INAPP) }
                    .forEach { scope.launch { verify(it, type) } }
            }
        }
    }

    fun buy(activity: Activity, offer: Offer, obfuscatedAccountId: String?) {
        val p = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(offer.details)
        offer.offerToken?.let { p.setOfferToken(it) }
        val flow = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(p.build()))
        obfuscatedAccountId?.let { flow.setObfuscatedAccountId(it) }
        _state.value = PurchaseState.Working
        val r = client.launchBillingFlow(activity, flow.build())
        if (r.responseCode != BillingClient.BillingResponseCode.OK) _state.value = PurchaseState.Failed("billing_unavailable")
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> purchases.orEmpty().forEach { p ->
                val type = if (p.products.any { it in Products.INAPP }) BillingClient.ProductType.INAPP else BillingClient.ProductType.SUBS
                scope.launch { verify(p, type) }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> _state.value = PurchaseState.Idle
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> { _state.value = PurchaseState.Idle; restore() }
            else -> _state.value = PurchaseState.Failed("billing_failed")
        }
    }

    private suspend fun verify(p: Purchase, type: String) {
        val product = p.products.first()
        if (p.purchaseState != Purchase.PurchaseState.PURCHASED) { _state.value = PurchaseState.Pending(product); return }
        try {
            val r = cloud.verifyPlayPurchase(product, p.purchaseToken, if (type == BillingClient.ProductType.SUBS) "subs" else "inapp")
            if (!r.ok) { _state.value = PurchaseState.Pending(product); return }
            if (type == BillingClient.ProductType.INAPP) {
                suspendCancellableCoroutine { c -> client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) { _, _ -> c.resume(Unit) } }
            }
            _state.value = PurchaseState.Confirmed(product)
        } catch (e: CloudException) {
            _state.value = PurchaseState.Pending(product)
        }
    }

    fun reset() { _state.value = PurchaseState.Idle }
}
