package com.deskhead.gente

import android.app.Application
import android.content.Intent
import android.os.Build
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.deskhead.gente.agent.ApprovalCenter
import com.deskhead.gente.agent.ChatEngine
import com.deskhead.gente.agent.Settings
import com.deskhead.gente.auth.AuthState
import com.deskhead.gente.auth.ClerkAuth
import com.deskhead.gente.billing.PlayBilling
import com.deskhead.gente.data.EgressEntity
import com.deskhead.gente.data.GenteDatabase
import com.deskhead.gente.net.CloudApi
import com.deskhead.gente.net.EgressSink
import com.deskhead.gente.privacy.DataCenter
import com.deskhead.gente.push.Notifications
import com.deskhead.gente.push.PushProvider
import com.deskhead.gente.push.StubPush
import com.deskhead.gente.security.KeyManager
import com.deskhead.gente.security.Vault
import com.deskhead.gente.sync.LinkService
import com.deskhead.gente.sync.RelayClient
import com.deskhead.gente.voice.Speaker
import com.deskhead.gente.voice.SpeechInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import kotlin.system.exitProcess

/** One place that builds everything. No DI framework: fewer moving parts, faster start. */
class AppGraph(
    val app: Application,
    val keys: Vault = KeyManager(app),
    val db: GenteDatabase = GenteDatabase.encrypted(app, keys.databasePassphrase()),
    cloudBase: String = BuildConfig.CLOUD_BASE_URL,
) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val dao = db.dao()
    val settings = Settings(app)

    private val egress = EgressSink { r ->
        scope.launch { dao.logEgress(EgressEntity(at = r.at, service = r.service.name, method = r.method, path = r.path, bytesOut = r.bytesOut, bytesIn = r.bytesIn, status = r.status, carriesChat = r.service.carriesChat)) }
    }
    private val authHttp = OkHttpClient.Builder().addInterceptor(com.deskhead.gente.net.EgressInterceptor(egress)).build()
    val auth = ClerkAuth(app, keys, authHttp, BuildConfig.CLERK_FRONTEND_API, BuildConfig.CLERK_OAUTH_CLIENT_ID)
    val cloud = CloudApi(cloudBase, egress, { auth.token() })
    val approvals = ApprovalCenter(dao)
    val link = LinkService(dao, keys, RelayClient(cloudBase, cloud.http) { auth.token() }, approvals, Build.MODEL ?: "Android")
    val chats = ChatEngine(
        dao, cloud, link, approvals, settings,
        signedIn = { auth.state.value is AuthState.SignedIn },
        filesDir = app.filesDir, scope = scope,
        demoText = { app.getString(R.string.demo_reply) },
    )
    val billing = PlayBilling(app, cloud, scope)
    val speech = SpeechInput(app)
    val speaker = Speaker(app, cloud) { auth.token() }
    val dataCenter = DataCenter(dao, cloud)
    val push: PushProvider = StubPush

    init {
        scope.launch { link.loop { ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) } }
    }

    /** Delete everything on this phone: database, keys, files, sign-in. Then start fresh. */
    fun wipeAndRestart() {
        speaker.release()
        db.close()
        app.deleteDatabase(GenteDatabase.FILE)
        app.filesDir.deleteRecursively()
        app.cacheDir.deleteRecursively()
        auth.signOut()
        keys.destroyAll()
        app.getSharedPreferences("km", 0).edit().clear().commit()
        java.io.File(app.filesDir.parentFile, "files/datastore").deleteRecursively()
        app.startActivity(Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        exitProcess(0)
    }
}

open class GenteApp : Application() {
    lateinit var graph: AppGraph
        protected set

    override fun onCreate() {
        super.onCreate()
        graph = buildGraph()
        Notifications.createChannels(this)
    }

    protected open fun buildGraph(): AppGraph = AppGraph(this)
}

val android.content.Context.graph: AppGraph get() = (applicationContext as GenteApp).graph
