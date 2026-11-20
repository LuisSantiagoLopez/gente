package com.deskhead.gente.agent

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** Where answers are made. Reversible at any time; every message keeps a badge of where it ran. */
enum class AiLocation { CLOUD, DESKTOP, PHONE }

data class Prefs(
    val aiLocation: AiLocation = AiLocation.CLOUD,
    val cloudVoice: Boolean = false, // off: replies are read by the phone's own voice, nothing leaves
    val dynamicColor: Boolean = false,
    val haptics: Boolean = true,
    val onboarded: Boolean = false,
    /** Off by default: someone who chose their computer for privacy is not moved to the cloud silently. */
    val slowFallbackToCloud: Boolean = false,
    /** "Always send" anonymous repair reports (failure, step, outcome, time, version). Off by default. */
    val shareRepairs: Boolean = false,
)

private val Context.store by preferencesDataStore("prefs")

class Settings(private val context: Context) {
    private val kLoc = stringPreferencesKey("ai_location")
    private val kVoice = booleanPreferencesKey("cloud_voice")
    private val kDyn = booleanPreferencesKey("dynamic_color")
    private val kHap = booleanPreferencesKey("haptics")
    private val kOnb = booleanPreferencesKey("onboarded")
    private val kSlow = booleanPreferencesKey("slow_fallback_cloud")
    private val kShare = booleanPreferencesKey("share_repairs")

    val prefs: Flow<Prefs> = context.store.data.map { p ->
        Prefs(
            aiLocation = p[kLoc]?.let { runCatching { AiLocation.valueOf(it) }.getOrNull() }?.takeIf { it != AiLocation.PHONE } ?: AiLocation.CLOUD,
            cloudVoice = p[kVoice] ?: false,
            dynamicColor = p[kDyn] ?: false,
            haptics = p[kHap] ?: true,
            onboarded = p[kOnb] ?: false,
            slowFallbackToCloud = p[kSlow] ?: false,
            shareRepairs = p[kShare] ?: false,
        )
    }

    suspend fun now(): Prefs = prefs.first()
    suspend fun setLocation(l: AiLocation) { if (l != AiLocation.PHONE) context.store.edit { it[kLoc] = l.name } }
    suspend fun setCloudVoice(v: Boolean) = context.store.edit { it[kVoice] = v }
    suspend fun setDynamicColor(v: Boolean) = context.store.edit { it[kDyn] = v }
    suspend fun setHaptics(v: Boolean) = context.store.edit { it[kHap] = v }
    suspend fun setSlowFallbackToCloud(v: Boolean) = context.store.edit { it[kSlow] = v }
    suspend fun setShareRepairs(v: Boolean) = context.store.edit { it[kShare] = v }
    suspend fun setOnboarded() = context.store.edit { it[kOnb] = true }
    suspend fun clear() = context.store.edit { it.clear() }
}
