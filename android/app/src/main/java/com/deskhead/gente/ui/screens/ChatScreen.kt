@file:OptIn(ExperimentalSharedTransitionApi::class, ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package com.deskhead.gente.ui.screens

import android.Manifest
import android.content.ClipData
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.VolumeOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.deskhead.gente.AppGraph
import com.deskhead.gente.R
import com.deskhead.gente.agent.AiLocation
import com.deskhead.gente.agent.Ran
import com.deskhead.gente.data.MessageEntity
import com.deskhead.gente.ui.components.GenteMark
import com.deskhead.gente.ui.components.PrivacyBadge
import com.deskhead.gente.ui.components.StreamingText
import com.deskhead.gente.ui.theme.LocalGenteExtras
import com.deskhead.gente.voice.SpeechInput
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
fun SharedTransitionScope.ChatScreen(
    graph: AppGraph,
    chatId: String,
    seed: String?,
    visibility: AnimatedVisibilityScope,
    sharedKey: String,
    back: () -> Unit,
    openPaywall: () -> Unit,
    openPair: () -> Unit,
    toast: (String) -> Unit,
) {
    val messages by graph.dao.messages(chatId).collectAsState(initial = emptyList())
    val prefs by graph.settings.prefs.collectAsState(initial = com.deskhead.gente.agent.Prefs())
    val devices by graph.dao.devices().collectAsState(initial = emptyList())
    val speaking by graph.speaker.speakingId.collectAsState()
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val ctx = LocalContext.current
    var whereSheet by remember { mutableStateOf(false) }
    var reportFor by remember { mutableStateOf<MessageEntity?>(null) }
    var menu by remember { mutableStateOf(false) }
    val running = messages.any { it.status == "streaming" }

    LaunchedEffect(seed) { if (!seed.isNullOrBlank() && messages.isEmpty()) graph.chats.send(chatId, seed) }
    // Reverse layout keeps the newest message pinned to the composer while it streams.
    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) listState.animateScrollToItem(0) }

    Scaffold(
        modifier = Modifier.sharedBounds(rememberSharedContentState(sharedKey), visibility),
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, stringResource(R.string.cd_back)) } },
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        GenteMark(size = 24.dp, thinking = running)
                        Spacer(Modifier.width(10.dp))
                        Text(
                            messages.firstOrNull { it.role == "user" }?.text ?: stringResource(R.string.new_chat),
                            maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium,
                        )
                    }
                },
                actions = {
                    WhereChip(prefs.aiLocation) { whereSheet = true }
                    IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, null) }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.continue_on_computer)) },
                            leadingIcon = { Icon(Icons.Outlined.Computer, null) },
                            onClick = {
                                menu = false
                                scope.launch {
                                    runCatching { graph.link.handoff(chatId) }
                                        .onSuccess { toast(ctx.getString(R.string.handed_off)) }
                                        .onFailure { toast(ctx.getString(com.deskhead.gente.ui.components.ErrorText.of((it as? com.deskhead.gente.net.CloudException)?.code ?: ""))) }
                                }
                            },
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        bottomBar = {
            Composer(
                graph = graph,
                running = running,
                onSend = { text -> haptic.performHapticFeedback(HapticFeedbackType.Confirm); graph.chats.send(chatId, text) },
                onStop = { haptic.performHapticFeedback(HapticFeedbackType.Reject); graph.chats.stop(chatId) },
            )
        },
    ) { pad ->
        LazyColumn(
            state = listState,
            reverseLayout = true,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = pad.calculateTopPadding() + 8.dp, bottom = pad.calculateBottomPadding() + 16.dp, start = 16.dp, end = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Bottom),
        ) {
            items(messages.asReversed(), key = { it.id }) { m ->
                Box(Modifier.animateItem()) {
                    when (m.role) {
                        "user" -> UserBubble(m)
                        "tool" -> ToolLine(m)
                        else -> AssistantMessage(
                            m,
                            speaking = speaking == m.id,
                            onSpeak = {
                                scope.launch {
                                    if (speaking == m.id) graph.speaker.stop()
                                    else if (prefs.cloudVoice) graph.speaker.speakCloud(m.id, m.text, Locale.getDefault().language)
                                    else graph.speaker.speakLocal(m.id, m.text)
                                }
                            },
                            onCopy = { scope.launch { /* copied below */ } },
                            onReport = { reportFor = m },
                            onRetry = {
                                val q = messages.lastOrNull { it.role == "user" && it.createdAt <= m.createdAt }?.text
                                if (q != null) graph.chats.send(chatId, q)
                            },
                            onPlans = openPaywall,
                        )
                    }
                }
            }
        }
    }

    if (whereSheet) WhereSheet(prefs.aiLocation, paired = devices.isNotEmpty(), onPair = { whereSheet = false; openPair() }, onDismiss = { whereSheet = false }) { l ->
        haptic.performHapticFeedback(HapticFeedbackType.SegmentTick)
        scope.launch { graph.settings.setLocation(l) }
        whereSheet = false
    }
    reportFor?.let { m -> ReportDialog(graph, m, onDone = { sent -> reportFor = null; if (sent) toast(ctx.getString(R.string.report_sent)) }) }
}

@Composable
private fun WhereChip(loc: AiLocation, onClick: () -> Unit) {
    val (icon, label) = when (loc) {
        AiLocation.CLOUD -> Icons.Outlined.Cloud to R.string.where_cloud
        AiLocation.DESKTOP -> Icons.Outlined.Computer to R.string.where_desktop
        AiLocation.PHONE -> Icons.Outlined.PhoneAndroid to R.string.where_phone
    }
    val desc = stringResource(R.string.where_ai_runs) + ": " + stringResource(label)
    Surface(onClick = onClick, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.semantics { contentDescription = desc }) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(label), style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun UserBubble(m: MessageEntity) {
    val x = LocalGenteExtras.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Surface(
            color = x.chatUser, contentColor = x.onChatUser,
            shape = RoundedCornerShape(22.dp, 22.dp, 6.dp, 22.dp),
            modifier = Modifier.widthIn(max = 320.dp),
        ) { Text(m.text, Modifier.padding(horizontal = 16.dp, vertical = 11.dp), style = MaterialTheme.typography.bodyLarge) }
    }
}

@Composable
private fun ToolLine(m: MessageEntity) {
    val kind = m.text.substringBefore(':')
    val rest = m.text.substringAfter(':')
    val (icon: ImageVector, text: String) = when (kind) {
        "search" -> Icons.Rounded.Search to stringResource(R.string.tool_search, rest)
        "remember" -> Icons.Rounded.Psychology to stringResource(R.string.tool_remember, rest)
        "image" -> Icons.Rounded.Image to stringResource(R.string.tool_image, rest)
        "browser" -> Icons.Rounded.Language to stringResource(R.string.tool_browser, rest)
        "desktop" -> Icons.Outlined.Computer to stringResource(R.string.tool_desktop, rest)
        "approval" -> Icons.Rounded.Lock to stringResource(R.string.tool_waiting, rest.substringAfter(':'))
        "approved" -> Icons.Rounded.Check to stringResource(R.string.tool_approved, rest)
        "declined" -> Icons.Rounded.Close to stringResource(R.string.tool_declined, rest)
        else -> Icons.Rounded.Search to rest
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 4.dp)) {
        Icon(icon, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(8.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = LocalGenteExtras.current.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun AssistantMessage(
    m: MessageEntity,
    speaking: Boolean,
    onSpeak: () -> Unit,
    onCopy: () -> Unit,
    onReport: () -> Unit,
    onRetry: () -> Unit,
    onPlans: () -> Unit,
) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    Column(Modifier.fillMaxWidth().semantics { if (m.status == "streaming") liveRegion = LiveRegionMode.Polite }) {
        if (m.status == "needs_plan") {
            Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.primaryContainer) {
                Column(Modifier.padding(18.dp)) {
                    Text(stringResource(R.string.out_of_messages_title), style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(R.string.out_of_messages_body), style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = onPlans) { Text(stringResource(R.string.see_plans)) }
                }
            }
            return@Column
        }
        if (m.text.isEmpty() && m.status == "streaming") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                GenteMark(size = 22.dp, thinking = true)
                Spacer(Modifier.width(10.dp))
                Text(stringResource(R.string.thinking), style = MaterialTheme.typography.bodyMedium, color = LocalGenteExtras.current.muted)
            }
        } else {
            StreamingText(m.text, streaming = m.status == "streaming", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onBackground)
        }
        AnimatedVisibility(m.status != "streaming", enter = fadeIn(), exit = fadeOut()) {
            Column {
                if (m.status == "failed") {
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.reply_failed), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = onRetry) { Text(stringResource(R.string.retry)) }
                    }
                }
                if (m.status == "stopped") Text(stringResource(R.string.stopped), style = MaterialTheme.typography.labelSmall, color = LocalGenteExtras.current.muted)
                Spacer(Modifier.height(6.dp))
                PrivacyBadge(m.ranOn)
                Row(Modifier.padding(top = 2.dp)) {
                    SmallAction(if (speaking) Icons.Rounded.VolumeOff else Icons.Outlined.VolumeUp, stringResource(if (speaking) R.string.stop_reading else R.string.read_aloud), onSpeak)
                    val copied = stringResource(R.string.copied)
                    SmallAction(Icons.Outlined.ContentCopy, stringResource(R.string.copy)) {
                        haptic.performHapticFeedback(HapticFeedbackType.Confirm)
                        scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(copied, m.text))) }
                        onCopy()
                    }
                    if (m.ranOn != Ran.DEMO) SmallAction(Icons.Outlined.Flag, stringResource(R.string.report), onReport)
                }
            }
        }
    }
}

@Composable
private fun SmallAction(icon: ImageVector, label: String, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(40.dp)) {
        Icon(icon, label, Modifier.size(18.dp), tint = LocalGenteExtras.current.muted)
    }
}

@Composable
private fun Composer(graph: AppGraph, running: Boolean, onSend: (String) -> Unit, onStop: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val stt by graph.speech.state.collectAsState()
    val ctx = LocalContext.current
    val focus = remember { FocusRequester() }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) graph.speech.start() }
    val listening = stt is SpeechInput.State.Listening
    LaunchedEffect(stt) {
        when (val s = stt) {
            is SpeechInput.State.Final -> { text = (text.trimEnd() + " " + s.text).trim(); graph.speech.consume() }
            else -> {}
        }
    }
    val shown = (stt as? SpeechInput.State.Listening)?.partial?.takeIf { it.isNotBlank() }?.let { (text + " " + it).trim() } ?: text
    val canSend = shown.isNotBlank() && !running
    // The send button morphs from a soft square to a circle when there is something to send.
    val corner by animateDpAsState(if (canSend || running) 24.dp else 14.dp, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessMediumLow), label = "corner")
    val level = (stt as? SpeechInput.State.Listening)?.level ?: 0f
    val micScale by animateFloatAsState(1f + level * 0.25f, spring(stiffness = Spring.StiffnessMedium), label = "mic")

    Surface(color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
            AnimatedVisibility(listening) {
                Text(stringResource(R.string.listening), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 12.dp, bottom = 6.dp))
            }
            (stt as? SpeechInput.State.Problem)?.let {
                Text(stringResource(com.deskhead.gente.ui.components.ErrorText.of(it.code)), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 12.dp, bottom = 6.dp))
            }
            Row(verticalAlignment = Alignment.Bottom) {
                TextField(
                    value = shown,
                    onValueChange = { text = it },
                    modifier = Modifier.weight(1f).focusRequester(focus),
                    placeholder = { Text(stringResource(R.string.composer_hint)) },
                    shape = RoundedCornerShape(26.dp),
                    maxLines = 6,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                        focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                    ),
                    trailingIcon = {
                        IconButton(
                            onClick = {
                                if (listening) graph.speech.stop()
                                else if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) graph.speech.start()
                                else micPermission.launch(Manifest.permission.RECORD_AUDIO)
                            },
                            modifier = Modifier.scale(micScale),
                        ) {
                            Icon(
                                Icons.Rounded.Mic,
                                stringResource(if (listening) R.string.cd_mic_stop else R.string.cd_mic),
                                tint = if (listening) MaterialTheme.colorScheme.primary else LocalGenteExtras.current.muted,
                            )
                        }
                    },
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(
                    onClick = {
                        if (running) onStop()
                        else if (canSend) { graph.speech.stop(); onSend(shown); text = "" }
                    },
                    enabled = canSend || running,
                    shape = RoundedCornerShape(corner),
                    modifier = Modifier.size(52.dp),
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary),
                ) {
                    AnimatedContent(running, transitionSpec = { (scaleIn() + fadeIn()) togetherWith (scaleOut() + fadeOut()) }, label = "send") { r ->
                        if (r) Icon(Icons.Rounded.Stop, stringResource(R.string.cd_stop)) else Icon(Icons.Rounded.ArrowUpward, stringResource(R.string.cd_send))
                    }
                }
            }
        }
    }
}

@Composable
fun WhereSheet(current: AiLocation, paired: Boolean, onPair: () -> Unit, onDismiss: () -> Unit, onPick: (AiLocation) -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 28.dp)) {
            Text(stringResource(R.string.where_ai_runs), style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(12.dp))
            WhereOption(Icons.Outlined.Cloud, R.string.where_cloud, R.string.where_cloud_body, current == AiLocation.CLOUD, enabled = true) { onPick(AiLocation.CLOUD) }
            WhereOption(Icons.Outlined.Computer, R.string.where_desktop, if (paired) R.string.where_desktop_body else R.string.where_desktop_unpaired, current == AiLocation.DESKTOP, enabled = paired) { onPick(AiLocation.DESKTOP) }
            if (!paired) TextButton(onClick = onPair, modifier = Modifier.padding(start = 48.dp)) { Text(stringResource(R.string.pair_now)) }
            WhereOption(Icons.Outlined.PhoneAndroid, R.string.where_phone, R.string.where_phone_body, false, enabled = false) {}
        }
    }
}

@Composable
private fun WhereOption(icon: ImageVector, title: Int, body: Int, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(MaterialTheme.shapes.medium)
            .selectable(selected, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .background(if (selected) MaterialTheme.colorScheme.primaryContainer else androidx.compose.ui.graphics.Color.Transparent)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (enabled) MaterialTheme.colorScheme.onSurface else LocalGenteExtras.current.muted)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(stringResource(title), style = MaterialTheme.typography.titleMedium, color = if (enabled) MaterialTheme.colorScheme.onSurface else LocalGenteExtras.current.muted)
            Text(stringResource(body), style = MaterialTheme.typography.bodyMedium, color = LocalGenteExtras.current.muted)
        }
        RadioButton(selected, onClick = null, enabled = enabled)
    }
}

@Composable
private fun ReportDialog(graph: AppGraph, m: MessageEntity, onDone: (Boolean) -> Unit) {
    val reasons = listOf(R.string.report_offensive to "offensive", R.string.report_harmful to "harmful", R.string.report_sexual to "sexual", R.string.report_false to "false", R.string.report_other to "other")
    var reason by remember { mutableStateOf("offensive") }
    var include by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = { onDone(false) },
        title = { Text(stringResource(R.string.report_title)) },
        text = {
            Column {
                Text(stringResource(R.string.report_body), style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                reasons.forEach { (res, key) ->
                    Row(Modifier.fillMaxWidth().selectable(reason == key, role = Role.RadioButton) { reason = key }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(reason == key, null); Spacer(Modifier.width(10.dp)); Text(stringResource(res))
                    }
                }
                Row(Modifier.fillMaxWidth().toggleable(include, role = Role.Checkbox) { include = it }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(include, null); Spacer(Modifier.width(10.dp))
                    Column {
                        Text(stringResource(R.string.report_include_text))
                        Text(stringResource(R.string.report_include_text_hint), style = MaterialTheme.typography.labelSmall, color = LocalGenteExtras.current.muted)
                    }
                }
                failed?.let { Text(stringResource(com.deskhead.gente.ui.components.ErrorText.of(it)), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            Button(enabled = !sending, onClick = {
                sending = true
                scope.launch {
                    runCatching { graph.cloud.reportAiOutput(m.id, reason, if (include) m.text else null) }
                        .onSuccess { graph.dao.markReported(m.id); onDone(true) }
                        .onFailure { failed = (it as? com.deskhead.gente.net.CloudException)?.code ?: "unknown"; sending = false }
                }
            }) { Text(stringResource(R.string.report_send)) }
        },
        dismissButton = { TextButton(onClick = { onDone(false) }) { Text(stringResource(R.string.cancel)) } },
    )
}
