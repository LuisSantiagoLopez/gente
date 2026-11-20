@file:OptIn(ExperimentalSharedTransitionApi::class)

package com.deskhead.gente

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.deskhead.gente.agent.AiLocation
import com.deskhead.gente.agent.Notice
import com.deskhead.gente.agent.Prefs
import com.deskhead.gente.auth.AuthState
import com.deskhead.gente.sync.LinkEvent
import com.deskhead.gente.ui.components.ErrorText
import com.deskhead.gente.ui.screens.ApprovalHost
import com.deskhead.gente.ui.screens.ChatScreen
import com.deskhead.gente.ui.screens.DataScreen
import com.deskhead.gente.ui.screens.EgressScreen
import com.deskhead.gente.ui.screens.HomeScreen
import com.deskhead.gente.ui.screens.LiveViewScreen
import com.deskhead.gente.ui.screens.PairScreen
import com.deskhead.gente.ui.screens.PaywallScreen
import com.deskhead.gente.ui.screens.SettingsScreen
import com.deskhead.gente.ui.screens.WelcomeScreen
import com.deskhead.gente.ui.theme.GenteTheme
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import java.net.URLEncoder

class MainActivity : ComponentActivity() {
    /** Intents that open something: "ask" (widget, tile, assistant), "approval", "chat". */
    private val intents = MutableSharedFlow<Intent>(extraBufferCapacity = 4)

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        handleAuth(intent)
        setContent {
            val prefs by graph.settings.prefs.collectAsState(initial = null)
            val p = prefs
            GenteTheme(dynamicColor = p?.dynamicColor ?: false) { if (p != null) Root(p) }
        }
        if (savedInstanceState == null) intent?.let { intents.tryEmit(it) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleAuth(intent)
        intents.tryEmit(intent)
    }

    private fun handleAuth(i: Intent?) {
        val data: Uri = i?.data ?: return
        if (data.scheme == "com.deskhead.gente" && data.host == "oauth") lifecycleScope.launch { graph.auth.handleRedirect(data) }
    }

    @Composable
    private fun Root(prefs: Prefs) {
        val nav = rememberNavController()
        val snack = remember { SnackbarHostState() }
        val scope = rememberCoroutineScope()
        val auth by graph.auth.state.collectAsState()
        val toast: (String) -> Unit = { m -> scope.launch { snack.currentSnackbarData?.dismiss(); snack.showSnackbar(m) } }
        var start by remember { mutableStateOf<String?>(null) }
        LaunchedEffect(prefs.onboarded, auth) { if (start == null) start = if (prefs.onboarded || auth is AuthState.SignedIn) "home" else "welcome" }

        LaunchedEffect(Unit) {
            graph.chats.notices.collect { n ->
                when (n) {
                    is Notice.Problem -> toast(getString(ErrorText.of(n.code)))
                    Notice.NeedsPlan -> {}
                    is Notice.LiveView -> nav.navigate("live?url=${URLEncoder.encode(n.url, "UTF-8")}&sid=${n.sessionId}")
                    is Notice.LocationFallback -> toast(getString(if (n.wanted == AiLocation.DESKTOP) R.string.where_fallback_desktop else R.string.where_fallback_phone))
                }
            }
        }
        LaunchedEffect(Unit) {
            graph.link.events.collect { e ->
                when (e) {
                    is LinkEvent.OpenChat -> nav.navigate("chat/${e.chatId}")
                    is LinkEvent.Paired -> toast(getString(R.string.pair_done, e.name))
                    is LinkEvent.TaskStatus -> toast(e.text.ifBlank { e.state })
                }
            }
        }
        LaunchedEffect(Unit) {
            intents.collect { i ->
                when {
                    i.action == Intent.ACTION_ASSIST || i.action == ACTION_ASK || i.action == Intent.ACTION_VOICE_COMMAND -> {
                        nav.navigate("chat/${graph.chats.newChatNow()}")
                    }
                    i.getStringExtra("approval") != null -> nav.navigate("home") { launchSingleTop = true }
                    i.action == Intent.ACTION_SEND -> i.getStringExtra(Intent.EXTRA_TEXT)?.let { t ->
                        nav.navigate("chat/${graph.chats.newChatNow()}?seed=${URLEncoder.encode(t, "UTF-8")}")
                    }
                }
            }
        }
        LaunchedEffect(auth) { if (auth is AuthState.SignedIn && nav.currentDestination?.route == "welcome") { graph.settings.setOnboarded(); nav.navigate("home") { popUpTo("welcome") { inclusive = true } } } }

        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            val s = start ?: return@Box
            // On tablets and unfolded foldables the app is a calm centered column, not stretched rows.
            SharedTransitionLayout(Modifier.align(Alignment.TopCenter).widthIn(max = 760.dp).fillMaxSize()) {
                NavHost(
                    nav, startDestination = s,
                    enterTransition = { slideInHorizontally(tween(320)) { it / 6 } + fadeIn(tween(220)) },
                    exitTransition = { fadeOut(tween(160)) },
                    popEnterTransition = { fadeIn(tween(220)) },
                    popExitTransition = { slideOutHorizontally(tween(260)) { it / 6 } + fadeOut(tween(200)) },
                ) {
                    composable("welcome") {
                        WelcomeScreen(graph, onSignIn = { graph.auth.start() }, onTry = {
                            scope.launch { graph.settings.setOnboarded() }
                            nav.navigate("home") { popUpTo("welcome") { inclusive = true } }
                        })
                    }
                    composable("home") {
                        HomeScreen(
                            graph, this,
                            openChat = { nav.navigate("chat/$it") },
                            newChat = { seed -> val id = graph.chats.newChatNow(); nav.navigate("chat/$id?shared=new" + (seed?.let { "&seed=" + URLEncoder.encode(it, "UTF-8") } ?: "")) },
                            openData = { nav.navigate("data") },
                            openSettings = { nav.navigate("settings") },
                            openApprovals = {},
                        )
                    }
                    composable(
                        "chat/{id}?seed={seed}&shared={shared}",
                        arguments = listOf(
                            navArgument("id") { type = NavType.StringType },
                            navArgument("seed") { type = NavType.StringType; nullable = true },
                            navArgument("shared") { type = NavType.StringType; nullable = true },
                        ),
                    ) { e ->
                        val id = e.arguments!!.getString("id")!!
                        val sharedKey = if (e.arguments?.getString("shared") == "new") "chat-new" else "chat-$id"
                        ChatScreen(
                            graph, id, e.arguments?.getString("seed"), this, sharedKey,
                            back = { nav.popBackStack() }, openPaywall = { nav.navigate("paywall") }, openPair = { nav.navigate("pair") }, toast = toast,
                        )
                    }
                    composable("data") { DataScreen(graph, back = { nav.popBackStack() }, openEgress = { nav.navigate("egress") }, toast = toast) }
                    composable("egress") { EgressScreen(graph) { nav.popBackStack() } }
                    composable("settings") {
                        SettingsScreen(graph, back = { nav.popBackStack() }, openPaywall = { nav.navigate("paywall") }, openPair = { nav.navigate("pair") }, signIn = { graph.auth.start() }, toast = toast)
                    }
                    composable("paywall") { PaywallScreen(graph, back = { nav.popBackStack() }) { this@MainActivity } }
                    composable("pair") { PairScreen(graph, back = { nav.popBackStack() }, toast = toast) }
                    composable(
                        "live?url={url}&sid={sid}",
                        arguments = listOf(navArgument("url") { type = NavType.StringType }, navArgument("sid") { type = NavType.StringType }),
                    ) { e -> LiveViewScreen(graph, e.arguments!!.getString("url")!!, e.arguments!!.getString("sid")!!) { nav.popBackStack() } }
                }
            }
            ApprovalHost(graph)
            SnackbarHost(snack, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 80.dp))
        }
    }

    @Suppress("unused") private fun NavHostController.safePop() = popBackStack()

    companion object { const val ACTION_ASK = "com.deskhead.gente.ASK" }
}
