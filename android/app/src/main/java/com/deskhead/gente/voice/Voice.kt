package com.deskhead.gente.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import com.deskhead.gente.net.CloudApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

/** Speech to text that runs on the phone. Audio never leaves it. */
class SpeechInput(private val context: Context) {
    sealed interface State {
        data object Idle : State
        data class Listening(val partial: String, val level: Float) : State
        data class Final(val text: String) : State
        data class Problem(val code: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state
    private var recognizer: SpeechRecognizer? = null

    val onDeviceAvailable: Boolean get() = SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    fun start(language: String = Locale.getDefault().toLanguageTag()) {
        stop()
        if (!onDeviceAvailable) { _state.value = State.Problem("stt_unavailable"); return }
        val r = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        recognizer = r
        _state.value = State.Listening("", 0f) // instant feedback; the recognizer confirms in onReadyForSpeech
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { _state.value = State.Listening("", 0f) }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {
                val s = _state.value
                if (s is State.Listening) _state.value = s.copy(level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f))
            }
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) {
                _state.value = if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) State.Idle else State.Problem("stt_failed")
            }
            override fun onResults(results: Bundle?) {
                val t = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                _state.value = if (t.isBlank()) State.Idle else State.Final(t)
            }
            override fun onPartialResults(partialResults: Bundle?) {
                val t = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                val s = _state.value
                _state.value = State.Listening(t, (s as? State.Listening)?.level ?: 0f)
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        })
    }

    fun stop() { recognizer?.destroy(); recognizer = null; if (_state.value is State.Listening) _state.value = State.Idle }
    fun consume() { _state.value = State.Idle }
}

/**
 * Reads replies aloud. Default: the phone's own voice, nothing leaves the phone.
 * Opt-in cloud voice streams audio/mpeg from /v1/proxy/tts and starts playing as bytes arrive.
 */
@OptIn(UnstableApi::class)
class Speaker(private val context: Context, private val cloud: CloudApi, private val token: suspend () -> String?) {
    private var tts: TextToSpeech? = null
    private var player: ExoPlayer? = null
    private val _speakingId = MutableStateFlow<String?>(null)
    val speakingId: StateFlow<String?> = _speakingId

    fun speakLocal(id: String, text: String, locale: Locale = Locale.getDefault()) {
        stop()
        _speakingId.value = id
        val engine = tts
        if (engine == null) {
            tts = TextToSpeech(context) { status ->
                if (status == TextToSpeech.SUCCESS) { tts?.language = locale; tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) }
                else _speakingId.value = null
            }
        } else {
            engine.language = locale
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
        }
    }

    suspend fun speakCloud(id: String, text: String, language: String) {
        stop()
        val t = token() ?: return speakLocal(id, text)
        val (url, body) = cloud.ttsRequest(text.take(2500), language)
        val ds = OkHttpDataSource.Factory(cloud.http)
            .setDefaultRequestProperties(mapOf("Authorization" to "Bearer $t", "Content-Type" to "application/json"))
        val p = ExoPlayer.Builder(context).build()
        player = p
        _speakingId.value = id
        p.setMediaSource(ProgressiveMediaSource.Factory { PostDataSource(ds.createDataSource(), body) }.createMediaSource(MediaItem.fromUri(url)))
        p.prepare()
        p.play()
    }

    fun stop() {
        tts?.stop(); player?.release(); player = null; _speakingId.value = null
    }

    fun release() { stop(); tts?.shutdown(); tts = null }
}

/** Wraps a DataSource so every open is a POST with our JSON body (the TTS endpoint is POST). */
@OptIn(UnstableApi::class)
private class PostDataSource(private val inner: androidx.media3.datasource.DataSource, private val body: ByteArray) : androidx.media3.datasource.DataSource by inner {
    override fun open(dataSpec: DataSpec): Long =
        inner.open(dataSpec.buildUpon().setHttpMethod(DataSpec.HTTP_METHOD_POST).setHttpBody(body).build())
}
