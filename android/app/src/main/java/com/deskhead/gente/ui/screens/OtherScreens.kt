@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package com.deskhead.gente.ui.screens

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.provider.Settings as AndroidSettings
import android.webkit.WebView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.rounded.AccountBalanceWallet
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.DeleteForever
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.deskhead.gente.AppGraph
import com.deskhead.gente.BuildConfig
import com.deskhead.gente.R
import com.deskhead.gente.auth.AuthState
import com.deskhead.gente.billing.Products
import com.deskhead.gente.billing.PurchaseState
import com.deskhead.gente.data.ApprovalEntity
import com.deskhead.gente.net.CloudException
import com.deskhead.gente.net.Service
import com.deskhead.gente.ui.components.ErrorText
import com.deskhead.gente.ui.components.GenteMark
import com.deskhead.gente.ui.components.Squiggle
import com.deskhead.gente.ui.theme.LocalGenteExtras
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

// ---------------------------------------------------------------- shared bits

@Composable
fun BackBar(title: String, back: () -> Unit, actions: @Composable () -> Unit = {}) {
    TopAppBar(
        title = { Text(title, Modifier.semantics { heading() }) },
        navigationIcon = { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, stringResource(R.string.cd_back)) } },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
    )
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 20.dp, bottom = 6.dp).semantics { heading() })
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) { Column { content() } }
}

private fun fmtBytes(b: Long): String = when {
    b < 1024 -> "$b B"
    b < 1024 * 1024 -> "%.1f KB".format(b / 1024.0)
    else -> "%.1f MB".format(b / 1024.0 / 1024.0)
}

private fun fmtTime(t: Long) = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(t))

// ---------------------------------------------------------------- welcome

@Composable
fun WelcomeScreen(graph: AppGraph, onSignIn: () -> Unit, onTry: () -> Unit) {
    val auth by graph.auth.state.collectAsState()
    val pop = remember { Animatable(0.6f) }
    LaunchedEffect(Unit) { pop.animateTo(1f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessLow)) }
    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 28.dp).verticalScroll(rememberScrollState()),
    ) {
        Spacer(Modifier.height(72.dp))
        GenteMark(size = 72.dp, modifier = Modifier.scale(pop.value))
        Spacer(Modifier.height(28.dp))
        Text(stringResource(R.string.welcome_title), style = MaterialTheme.typography.headlineLarge, modifier = Modifier.semantics { heading() })
        Squiggle(Modifier.width(120.dp).height(12.dp))
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.welcome_body), style = MaterialTheme.typography.bodyLarge, color = LocalGenteExtras.current.muted)
        Spacer(Modifier.height(28.dp))
        WelcomePoint(Icons.Outlined.PhoneAndroid, R.string.welcome_point_phone)
        WelcomePoint(Icons.Outlined.Cloud, R.string.welcome_point_server)
        WelcomePoint(Icons.Outlined.Lock, R.string.welcome_point_ask)
        Spacer(Modifier.weight(1f).height(32.dp))
        Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth().height(56.dp), enabled = auth !is AuthState.Working) {
            Text(stringResource(if (auth is AuthState.Working) R.string.signing_in else R.string.sign_in), style = MaterialTheme.typography.titleMedium)
        }
        TextButton(onClick = onTry, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text(stringResource(R.string.try_first)) }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun WelcomePoint(icon: ImageVector, text: Int) {
    Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.Top) {
        Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.primaryContainer) { Icon(icon, null, Modifier.padding(8.dp).size(20.dp)) }
        Spacer(Modifier.width(14.dp))
        Text(stringResource(text), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 4.dp))
    }
}

// ---------------------------------------------------------------- approvals

@Composable
fun ApprovalHost(graph: AppGraph) {
    val pending by graph.dao.pendingApprovals().collectAsState(initial = emptyList())
    val current = pending.lastOrNull() ?: return
    ApprovalSheet(current) { yes ->
        // Desktop approvals are answered back through the encrypted relay.
        graph.scope.launch {
            val a = graph.approvals.decide(current.id, yes)
            if (a?.source == "desktop") runCatching { graph.link.answerApproval(current.id, yes) }
        }
    }
}

@Composable
fun ApprovalSheet(a: ApprovalEntity, decide: (Boolean) -> Unit) {
    val haptic = LocalHapticFeedback.current
    val (icon, what) = when (a.kind) {
        "money" -> Icons.Rounded.AccountBalanceWallet to R.string.approval_money
        "send_as_user" -> Icons.Rounded.Send to R.string.approval_send
        "delete_data" -> Icons.Rounded.DeleteForever to R.string.approval_delete
        "legal" -> Icons.Rounded.Gavel to R.string.approval_legal
        else -> Icons.Outlined.Lock to R.string.approval_other
    }
    LaunchedEffect(a.id) { haptic.performHapticFeedback(HapticFeedbackType.LongPress) }
    ModalBottomSheet(onDismissRequest = { /* must choose */ }, sheetGesturesEnabled = false) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 28.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.primaryContainer) { Icon(icon, null, Modifier.padding(10.dp).size(24.dp)) }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(stringResource(R.string.approval_title), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    Text(stringResource(what), style = MaterialTheme.typography.labelMedium, color = LocalGenteExtras.current.muted)
                }
            }
            Spacer(Modifier.height(16.dp))
            Text(a.title, style = MaterialTheme.typography.headlineSmall)
            if (a.source != "phone") {
                Spacer(Modifier.height(4.dp))
                Text(stringResource(if (a.source == "desktop") R.string.approval_from_desktop else R.string.approval_from_routine), style = MaterialTheme.typography.labelMedium, color = LocalGenteExtras.current.muted)
            }
            Spacer(Modifier.height(12.dp))
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
                Text(a.detail, Modifier.padding(14.dp).fillMaxWidth(), style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(10.dp))
            Text(stringResource(R.string.approval_always_asks), style = MaterialTheme.typography.labelSmall, color = LocalGenteExtras.current.muted)
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { haptic.performHapticFeedback(HapticFeedbackType.Reject); decide(false) }, modifier = Modifier.weight(1f).height(54.dp)) { Text(stringResource(R.string.decline)) }
                Button(onClick = { haptic.performHapticFeedback(HapticFeedbackType.Confirm); decide(true) }, modifier = Modifier.weight(1f).height(54.dp)) { Text(stringResource(R.string.approve)) }
            }
        }
    }
}

// ---------------------------------------------------------------- where's my data

@Composable
fun DataScreen(graph: AppGraph, back: () -> Unit, openEgress: () -> Unit, toast: (String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val chats by graph.dao.chatCount().collectAsState(0)
    val msgs by graph.dao.messageCount().collectAsState(0)
    val mems by graph.dao.memoryCount().collectAsState(0)
    val files by graph.dao.fileCount().collectAsState(0)
    val devices by graph.dao.devices().collectAsState(emptyList())
    val events by graph.dao.events().collectAsState(emptyList())
    val egress by graph.dao.egress().collectAsState(emptyList())
    val auth by graph.auth.state.collectAsState()
    val receipts by produceState(initialValue = emptyList<com.deskhead.gente.net.DeletionReceipt>(), auth) {
        if (auth is AuthState.SignedIn) value = runCatching { graph.cloud.receipts().receipts }.getOrDefault(emptyList())
    }
    var confirmDelete by remember { mutableStateOf(false) }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) scope.launch {
            runCatching { ctx.contentResolver.openOutputStream(uri)?.use { graph.dataCenter.exportTo(it) } }
                .onSuccess { toast(ctx.getString(R.string.data_exported)) }
                .onFailure { toast(ctx.getString(R.string.err_generic)) }
        }
    }
    val e2e = devices.isNotEmpty()
    val phonePlace = stringResource(if (e2e) R.string.place_phone_computer else R.string.place_phone)

    Scaffold(topBar = { BackBar(stringResource(R.string.data_title), back) }) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), start = 16.dp, end = 16.dp, bottom = 48.dp)) {
            item {
                Text(stringResource(R.string.data_subtitle), style = MaterialTheme.typography.bodyMedium, color = LocalGenteExtras.current.muted)
                Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    com.deskhead.gente.ui.components.Pill(stringResource(R.string.storage_key, stringResource(if (graph.keys.usesStrongBox) R.string.storage_strongbox else R.string.storage_keystore)))
                    com.deskhead.gente.ui.components.Pill(stringResource(R.string.backup_off))
                }
                SectionTitle(stringResource(R.string.data_lives))
                Card {
                    DataRow(Icons.Outlined.PhoneAndroid, stringResource(R.string.data_chats), "$chats", phonePlace)
                    DataRow(Icons.Outlined.PhoneAndroid, stringResource(R.string.data_messages), "$msgs", phonePlace)
                    DataRow(Icons.Outlined.PhoneAndroid, stringResource(R.string.data_memory), "$mems", phonePlace)
                    DataRow(Icons.Outlined.Description, stringResource(R.string.data_files), "$files", stringResource(R.string.place_phone))
                    DataRow(Icons.Outlined.Cloud, stringResource(R.string.data_account), "", stringResource(R.string.place_cloud_account))
                    DataRow(Icons.Outlined.ShoppingBag, stringResource(R.string.data_purchases), "", stringResource(R.string.place_play))
                }
                SectionTitle(stringResource(R.string.data_what_left))
                Surface(onClick = openEgress, shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(stringResource(R.string.data_what_left_body), style = MaterialTheme.typography.bodyMedium)
                            Text("${egress.size} · ${fmtBytes(egress.sumOf { it.bytesOut })}", style = MaterialTheme.typography.labelMedium, color = LocalGenteExtras.current.muted)
                        }
                        Icon(Icons.AutoMirrored.Rounded.OpenInNew, null)
                    }
                }
                SectionTitle(stringResource(R.string.data_timeline))
            }
            if (events.isEmpty()) item { Text(stringResource(R.string.data_timeline_empty), style = MaterialTheme.typography.bodyMedium, color = LocalGenteExtras.current.muted) }
            items(events.take(50), key = { "ev${it.id}" }) { e ->
                val label = when (e.kind) {
                    "sync" -> R.string.ev_sync; "delete" -> R.string.ev_delete; "export" -> R.string.ev_export
                    "receipt" -> R.string.ev_receipt; "pair" -> R.string.ev_pair; else -> R.string.ev_send
                }
                ListItem(
                    headlineContent = { Text(e.detail, style = MaterialTheme.typography.bodyMedium) },
                    overlineContent = { Text(stringResource(label) + " · " + fmtTime(e.at)) },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
                )
            }
            item {
                SectionTitle(stringResource(R.string.data_receipts))
                if (receipts.isEmpty()) Text(stringResource(R.string.data_receipts_empty), style = MaterialTheme.typography.bodyMedium, color = LocalGenteExtras.current.muted)
                receipts.take(20).forEach { r ->
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.data_receipt_row, r.id.take(10))) },
                        supportingContent = { Text("${r.objectType} · ${r.reason} · ${r.deletedAt.take(16)}") },
                        leadingContent = { Icon(Icons.Rounded.CheckCircle, null, tint = LocalGenteExtras.current.success) },
                        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
                    )
                }
                Spacer(Modifier.height(24.dp))
                Card {
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.data_export)) },
                        supportingContent = { Text(stringResource(R.string.data_export_body)) },
                        leadingContent = { Icon(Icons.Rounded.Download, null) },
                        modifier = Modifier.clickable { export.launch("gente-export.json") },
                        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                    )
                    HorizontalDivider()
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.data_delete_all), color = MaterialTheme.colorScheme.error) },
                        supportingContent = { Text(stringResource(R.string.data_delete_all_body)) },
                        leadingContent = { Icon(Icons.Outlined.Delete, null, tint = MaterialTheme.colorScheme.error) },
                        modifier = Modifier.clickable { confirmDelete = true },
                        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                    )
                }
            }
        }
    }
    if (confirmDelete) DeleteEverythingDialog(graph, signedIn = auth is AuthState.SignedIn, includeCloudDefault = false, onDismiss = { confirmDelete = false }, toast = toast)
}

@Composable
fun DeleteEverythingDialog(graph: AppGraph, signedIn: Boolean, includeCloudDefault: Boolean, onDismiss: () -> Unit, toast: (String) -> Unit) {
    var alsoCloud by remember { mutableStateOf(includeCloudDefault && signedIn) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val ctx = LocalContext.current
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        icon = { Icon(Icons.Rounded.DeleteForever, null, tint = MaterialTheme.colorScheme.error) },
        title = { Text(stringResource(R.string.data_delete_confirm_title)) },
        text = {
            Column {
                Text(stringResource(R.string.data_delete_confirm_body))
                if (signedIn) Row(Modifier.padding(top = 12.dp).toggleable(alsoCloud, role = androidx.compose.ui.semantics.Role.Checkbox) { alsoCloud = it }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(alsoCloud, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.data_delete_also_cloud))
                }
                problem?.let { Text(stringResource(ErrorText.of(it)), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
            }
        },
        confirmButton = {
            Button(
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                onClick = {
                    busy = true
                    graph.scope.launch {
                        if (alsoCloud) {
                            val r = runCatching { graph.dataCenter.deleteCloudAccount() }
                            if (r.isFailure) { problem = (r.exceptionOrNull() as? CloudException)?.code ?: "unknown"; busy = false; return@launch }
                            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { toast(ctx.getString(R.string.delete_account_done, r.getOrThrow().receiptId)) }
                            kotlinx.coroutines.delay(1200)
                        }
                        graph.wipeAndRestart()
                    }
                },
            ) { if (busy) LoadingIndicator(Modifier.size(20.dp)) else Text(stringResource(R.string.delete)) }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
private fun DataRow(icon: ImageVector, title: String, count: String, place: String) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = { Text(place) },
        leadingContent = { Icon(icon, null) },
        trailingContent = { if (count.isNotEmpty()) Text(count, style = MaterialTheme.typography.titleMedium) },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    )
}

@Composable
fun EgressScreen(graph: AppGraph, back: () -> Unit) {
    val rows by graph.dao.egress().collectAsState(emptyList())
    val ctx = LocalContext.current
    Scaffold(topBar = { BackBar(stringResource(R.string.data_what_left), back) }) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), start = 8.dp, end = 8.dp, bottom = 32.dp)) {
            item { Text(stringResource(R.string.data_what_left_body), Modifier.padding(horizontal = 8.dp, vertical = 8.dp), style = MaterialTheme.typography.bodyMedium, color = LocalGenteExtras.current.muted) }
            if (rows.isEmpty()) item { Text(stringResource(R.string.egress_none), Modifier.padding(8.dp)) }
            items(rows, key = { it.id }) { r ->
                val svc = runCatching { Service.valueOf(r.service) }.getOrDefault(Service.OTHER)
                val name = ctx.getString(ctx.resources.getIdentifier("svc_${svc.name}", "string", ctx.packageName).takeIf { it != 0 } ?: R.string.svc_OTHER)
                ListItem(
                    overlineContent = { Text(fmtTime(r.at)) },
                    headlineContent = { Text(name) },
                    supportingContent = {
                        Text(stringResource(R.string.egress_row, r.method, fmtBytes(r.bytesOut), fmtBytes(r.bytesIn)) + if (r.carriesChat) "\n" + stringResource(R.string.egress_chat_note) else "")
                    },
                    leadingContent = { Icon(if (svc == Service.RELAY) Icons.Outlined.Lock else Icons.Outlined.Cloud, null) },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
                )
            }
        }
    }
}

// ---------------------------------------------------------------- settings

@Composable
fun SettingsScreen(graph: AppGraph, back: () -> Unit, openPaywall: () -> Unit, openPair: () -> Unit, signIn: () -> Unit, toast: (String) -> Unit) {
    val ctx = LocalContext.current
    val prefs by graph.settings.prefs.collectAsState(com.deskhead.gente.agent.Prefs())
    val auth by graph.auth.state.collectAsState()
    val devices by graph.dao.devices().collectAsState(emptyList())
    val scope = rememberCoroutineScope()
    val plan by produceState<com.deskhead.gente.net.Plan?>(null, auth) { if (auth is AuthState.SignedIn) value = runCatching { graph.cloud.plan() }.getOrNull() }
    val balance by produceState<com.deskhead.gente.net.Balance?>(null, auth) { if (auth is AuthState.SignedIn) value = runCatching { graph.cloud.balance() }.getOrNull() }
    var deleteAccount by remember { mutableStateOf(false) }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    fun open(url: String) = ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeFlexibleTopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
                navigationIcon = { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, stringResource(R.string.cd_back)) } },
                scrollBehavior = scroll,
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background, scrolledContainerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), start = 16.dp, end = 16.dp, bottom = 48.dp)) {
            item {
                SectionTitle(stringResource(R.string.account))
                Card {
                    if (auth is AuthState.SignedIn) {
                        val p = plan
                        val planName = when (p?.id) { "pro" -> R.string.plan_pro; "max" -> R.string.plan_max; "max_plus" -> R.string.plan_max_plus; else -> R.string.plan_free }
                        SettingRow(stringResource(R.string.plan_label), stringResource(planName)) { openPaywall() }
                        balance?.takeIf { p?.cloud == true }?.let { SettingRow(stringResource(R.string.hours_left, "%.1f".format(it.totalHours)), null) {} }
                        if (p != null && p.cloud.not() && p.messagesLimit != null) {
                            SettingRow(stringResource(R.string.free_left, (p.messagesLimit - (p.messagesUsed ?: 0)).coerceAtLeast(0), p.messagesLimit), null) {}
                        }
                        SettingRow(stringResource(R.string.upgrade), null) { openPaywall() }
                        SettingRow(stringResource(R.string.sign_out), null) { graph.auth.signOut() }
                    } else {
                        SettingRow(stringResource(R.string.signed_out), stringResource(R.string.sign_in)) { signIn() }
                    }
                }
                SectionTitle(stringResource(R.string.computer))
                Card {
                    SettingRow(stringResource(R.string.pair_computer), devices.firstOrNull()?.name) { openPair() }
                }
                SectionTitle(stringResource(R.string.voice))
                Card { SwitchRow(stringResource(R.string.cloud_voice), stringResource(R.string.cloud_voice_body), prefs.cloudVoice) { scope.launch { graph.settings.setCloudVoice(it) } } }
                SectionTitle(stringResource(R.string.look))
                Card {
                    SwitchRow(stringResource(R.string.dynamic_color), stringResource(R.string.dynamic_color_body), prefs.dynamicColor) { scope.launch { graph.settings.setDynamicColor(it) } }
                    SwitchRow(stringResource(R.string.haptics), null, prefs.haptics) { scope.launch { graph.settings.setHaptics(it) } }
                }
                SectionTitle(stringResource(R.string.routines))
                Card {
                    SettingRow(stringResource(R.string.routines_body), if (graph.push.live) null else stringResource(R.string.routines_push_off)) {}
                }
                SectionTitle(stringResource(R.string.language))
                Card {
                    SettingRow(stringResource(R.string.language_body), null) {
                        ctx.startActivity(Intent(AndroidSettings.ACTION_APP_LOCALE_SETTINGS, Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                }
                SectionTitle(stringResource(R.string.cd_data))
                Card {
                    SettingRow(stringResource(R.string.privacy_policy), null) { open(BuildConfig.PRIVACY_URL) }
                    SettingRow(stringResource(R.string.support), null) { open(BuildConfig.SUPPORT_URL) }
                    SettingRow(stringResource(R.string.delete_account), stringResource(R.string.delete_account_body), danger = true) { deleteAccount = true }
                }
                Text(stringResource(R.string.version, BuildConfig.VERSION_NAME), Modifier.padding(top = 20.dp), style = MaterialTheme.typography.labelSmall, color = LocalGenteExtras.current.muted)
            }
        }
    }
    if (deleteAccount) DeleteEverythingDialog(graph, signedIn = auth is AuthState.SignedIn, includeCloudDefault = true, onDismiss = { deleteAccount = false }, toast = toast)
}

@Composable
private fun SettingRow(title: String, value: String?, danger: Boolean = false, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(title, color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface) },
        supportingContent = value?.let { { Text(it) } },
        modifier = Modifier.clickable(onClick = onClick),
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    )
}

@Composable
private fun SwitchRow(title: String, body: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = body?.let { { Text(it) } },
        trailingContent = { Switch(checked, onCheckedChange = null) },
        modifier = Modifier.toggleable(checked, role = androidx.compose.ui.semantics.Role.Switch) { onChange(it) },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    )
}

// ---------------------------------------------------------------- paywall

@Composable
fun PaywallScreen(graph: AppGraph, back: () -> Unit, activity: () -> android.app.Activity?) {
    val offers by graph.billing.offers.collectAsState()
    val state by graph.billing.state.collectAsState()
    val auth by graph.auth.state.collectAsState()
    val scope = rememberCoroutineScope()
    var yearly by remember { mutableStateOf(false) }
    val server by produceState<List<com.deskhead.gente.net.PlanOffer>>(emptyList()) { value = runCatching { graph.cloud.playPlans().plans }.getOrDefault(emptyList()) }
    LaunchedEffect(Unit) { graph.billing.connect() }

    fun serverPrice(id: String, year: Boolean): String? = server.firstOrNull { it.id == id }?.let { p ->
        val cents = if (year) p.yearlyCents else p.monthlyCents
        cents?.let { java.text.NumberFormat.getCurrencyInstance(java.util.Locale.US).format(it / 100.0) }
    }
    fun hours(id: String) = server.firstOrNull { it.id == id }?.onlineHours ?: when (id) { "pro" -> 37; "max" -> 215; "max_plus" -> 430; else -> 0 }
    fun buy(product: String, basePlan: String?) {
        val o = offers.firstOrNull { it.productId == product && (basePlan == null || it.basePlanId == basePlan) } ?: return
        val act = activity() ?: return
        scope.launch {
            val acct = runCatching { graph.cloud.accountToken().googleObfuscatedAccountId }.getOrNull()
            graph.billing.buy(act, o, acct)
        }
    }

    Scaffold(topBar = { BackBar("", back) }) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), start = 20.dp, end = 20.dp, bottom = 40.dp)) {
            item {
                GenteMark(size = 44.dp)
                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.paywall_title), style = MaterialTheme.typography.headlineLarge)
                Squiggle(Modifier.width(110.dp).height(12.dp))
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.paywall_body), style = MaterialTheme.typography.bodyLarge, color = LocalGenteExtras.current.muted)
                Spacer(Modifier.height(20.dp))
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    SegmentedButton(!yearly, { yearly = false }, SegmentedButtonDefaults.itemShape(0, 2)) { Text(stringResource(R.string.monthly)) }
                    SegmentedButton(yearly, { yearly = true }, SegmentedButtonDefaults.itemShape(1, 2)) { Text(stringResource(R.string.yearly)) }
                }
                Spacer(Modifier.height(16.dp))
                val proOffer = offers.firstOrNull { it.productId == Products.PRO && it.basePlanId == (if (yearly) "pro-year" else "pro-month") }
                PlanCard(R.string.plan_pro, hours("pro"), proOffer?.price ?: serverPrice("pro", yearly), yearly, highlight = true, canBuy = proOffer != null) {
                    buy(Products.PRO, if (yearly) "pro-year" else "pro-month")
                }
                if (!yearly) {
                    val maxOffer = offers.firstOrNull { it.productId == Products.MAX }
                    val maxPlusOffer = offers.firstOrNull { it.productId == Products.MAX_PLUS }
                    PlanCard(R.string.plan_max, hours("max"), maxOffer?.price ?: serverPrice("max", false), false, canBuy = maxOffer != null) { buy(Products.MAX, "max-month") }
                    PlanCard(R.string.plan_max_plus, hours("max_plus"), maxPlusOffer?.price ?: serverPrice("max_plus", false), false, canBuy = maxPlusOffer != null) { buy(Products.MAX_PLUS, "max-plus-month") }
                }
                offers.firstOrNull { it.productId == Products.HOURS_8 }?.let { o ->
                    OutlinedButton(onClick = { buy(Products.HOURS_8, null) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(52.dp)) { Text(stringResource(R.string.buy_hours, o.price)) }
                }
                Spacer(Modifier.height(12.dp))
                AnimatedVisibility(state != PurchaseState.Idle) {
                    val msg = when (val s = state) {
                        PurchaseState.Working -> stringResource(R.string.purchase_working)
                        is PurchaseState.Confirmed -> stringResource(R.string.purchase_confirmed)
                        is PurchaseState.Pending -> stringResource(R.string.purchase_pending)
                        is PurchaseState.Failed -> stringResource(ErrorText.of(s.code))
                        else -> ""
                    }
                    Text(msg, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                }
                if (auth !is AuthState.SignedIn) Text(stringResource(R.string.err_sign_in), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { graph.billing.connect() }) { Text(stringResource(R.string.restore)) }
                Text(stringResource(R.string.paywall_terms), style = MaterialTheme.typography.labelSmall, color = LocalGenteExtras.current.muted)
            }
        }
    }
}

@Composable
private fun PlanCard(name: Int, hours: Int, price: String?, yearly: Boolean, highlight: Boolean = false, canBuy: Boolean = true, onBuy: () -> Unit) {
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        color = if (highlight) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
    ) {
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(name), style = MaterialTheme.typography.titleLarge)
                Text(stringResource(R.string.plan_hours, hours), style = MaterialTheme.typography.bodyMedium, color = LocalGenteExtras.current.muted)
                price?.let { Text(stringResource(if (yearly) R.string.per_year else R.string.per_month, it), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold) }
            }
            Button(onClick = onBuy, enabled = canBuy) { Text(stringResource(R.string.choose_plan, stringResource(name))) }
        }
    }
}

// ---------------------------------------------------------------- pairing

@Composable
fun PairScreen(graph: AppGraph, back: () -> Unit, toast: (String) -> Unit) {
    val ctx = LocalContext.current
    val devices by graph.dao.devices().collectAsState(emptyList())
    val safety by graph.link.safetyCode.collectAsState()
    val scope = rememberCoroutineScope()
    var paste by remember { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    fun pair(text: String) = scope.launch {
        problem = null
        runCatching { graph.link.pair(text) }.onFailure { problem = (it as? CloudException)?.code ?: "bad_qr" }
    }
    Scaffold(topBar = { BackBar(stringResource(R.string.pair_title), back) }) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), start = 20.dp, end = 20.dp, bottom = 40.dp)) {
            item {
                Text(stringResource(R.string.pair_body), style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = {
                        val opts = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
                        GmsBarcodeScanning.getClient(ctx, opts).startScan()
                            .addOnSuccessListener { b -> b.rawValue?.let { pair(it) } }
                            .addOnFailureListener { problem = "bad_qr" }
                    },
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                ) { Icon(Icons.Rounded.QrCodeScanner, null); Spacer(Modifier.width(10.dp)); Text(stringResource(R.string.pair_scan)) }
                TextButton(onClick = { paste = !paste }) { Text(stringResource(R.string.pair_paste)) }
                AnimatedVisibility(paste) {
                    Column {
                        OutlinedTextField(code, { code = it }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.pair_code_hint)) }, singleLine = true)
                        Button(onClick = { pair(code) }, enabled = code.isNotBlank(), modifier = Modifier.padding(top = 8.dp)) { Text(stringResource(R.string.pair_connect)) }
                    }
                }
                safety?.let {
                    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
                        Text(stringResource(R.string.pair_safety, it), Modifier.padding(16.dp), style = MaterialTheme.typography.titleMedium)
                    }
                }
                problem?.let { Text(stringResource(ErrorText.of(it)), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
                SectionTitle(stringResource(R.string.pair_devices))
                if (devices.isEmpty()) Text(stringResource(R.string.pair_none), color = LocalGenteExtras.current.muted)
            }
            items(devices, key = { it.id }) { d ->
                ListItem(
                    headlineContent = { Text(d.name) },
                    supportingContent = { Text(fmtTime(d.pairedAt)) },
                    leadingContent = { Icon(Icons.Outlined.Computer, null) },
                    trailingContent = { TextButton(onClick = { scope.launch { graph.link.unpair(d.id); toast(ctx.getString(R.string.unpair)) } }) { Text(stringResource(R.string.unpair)) } },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
                )
            }
            item {
                SectionTitle(stringResource(R.string.pair_what))
                listOf(R.string.pair_what_1, R.string.pair_what_2, R.string.pair_what_3, R.string.pair_what_4).forEach {
                    Row(Modifier.padding(vertical = 4.dp)) { Text("•  "); Text(stringResource(it), style = MaterialTheme.typography.bodyMedium) }
                }
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.pair_relay_note), style = MaterialTheme.typography.labelMedium, color = LocalGenteExtras.current.muted)
            }
        }
    }
}

// ---------------------------------------------------------------- live view

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LiveViewScreen(graph: AppGraph, url: String, sessionId: String, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    LaunchedEffect(sessionId) {
        while (true) { kotlinx.coroutines.delay(30_000); runCatching { graph.cloud.heartbeat(sessionId) } }
    }
    Scaffold(topBar = {
        BackBar(stringResource(R.string.live_title), back) {
            TextButton(onClick = { scope.launch { runCatching { graph.cloud.stopSession(sessionId) }; back() } }) { Text(stringResource(R.string.live_stop)) }
        }
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            AndroidView(factory = { c -> WebView(c).apply { settings.javaScriptEnabled = true; settings.domStorageEnabled = true; loadUrl(url) } }, modifier = Modifier.fillMaxSize())
        }
    }
}
