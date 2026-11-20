package com.deskhead.gente.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.deskhead.gente.MainActivity
import com.deskhead.gente.R

/**
 * Routines and approvals arrive by push. Firebase Cloud Messaging plugs in here once Santi's
 * Firebase project exists (google-services.json + com.google.firebase:firebase-messaging).
 * Until then [StubPush] is used: no network, no token, nothing registered.
 *
 * Push payloads carry ids only ("approval:<id>", "routine:<id>"), never content. The app fetches
 * the encrypted details through the relay after it opens.
 */
interface PushProvider {
    val live: Boolean
    suspend fun token(): String?
}

object StubPush : PushProvider {
    override val live = false
    override suspend fun token(): String? = null
}

object Notifications {
    const val APPROVALS = "approvals"
    const val ROUTINES = "routines"

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(APPROVALS, ctx.getString(R.string.channel_approvals), NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(ROUTINES, ctx.getString(R.string.channel_routines), NotificationManager.IMPORTANCE_DEFAULT))
    }

    /** Shows "Gente needs your OK" without saying what, so the lock screen shows no content. */
    fun approvalWaiting(ctx: Context, approvalId: String) {
        val open = PendingIntent.getActivity(
            ctx, approvalId.hashCode(),
            Intent(ctx, MainActivity::class.java).putExtra("approval", approvalId).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, APPROVALS)
            .setSmallIcon(R.drawable.ic_mark_mono)
            .setContentTitle(ctx.getString(R.string.push_approval_title))
            .setContentText(ctx.getString(R.string.push_approval_body))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(approvalId.hashCode(), n) }
    }
}
