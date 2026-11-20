@file:OptIn(ExperimentalSharedTransitionApi::class, ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package com.deskhead.gente.ui.screens

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.deskhead.gente.AppGraph
import com.deskhead.gente.R
import com.deskhead.gente.data.ChatSummary
import com.deskhead.gente.ui.components.GenteMark
import com.deskhead.gente.ui.components.Squiggle
import com.deskhead.gente.ui.theme.LocalGenteExtras
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SharedTransitionScope.HomeScreen(
    graph: AppGraph,
    visibility: AnimatedVisibilityScope,
    openChat: (String) -> Unit,
    newChat: (String?) -> Unit,
    openData: () -> Unit,
    openSettings: () -> Unit,
    openApprovals: () -> Unit,
) {
    val chats by graph.dao.chatSummaries().collectAsState(initial = null)
    val pending by graph.dao.pendingApprovals().collectAsState(initial = emptyList())
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeFlexibleTopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        GenteMark(size = 30.dp)
                        Spacer(Modifier.width(10.dp))
                        Text(stringResource(R.string.home_title), Modifier.semantics { heading() })
                    }
                },
                actions = {
                    IconButton(onClick = openData) { Icon(Icons.Outlined.Shield, stringResource(R.string.cd_data)) }
                    IconButton(onClick = openSettings) { Icon(Icons.Outlined.Settings, stringResource(R.string.cd_settings)) }
                },
                scrollBehavior = scroll,
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background, scrolledContainerColor = MaterialTheme.colorScheme.background),
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { haptic.performHapticFeedback(HapticFeedbackType.Confirm); newChat(null) },
                icon = { Icon(Icons.Rounded.Edit, null) },
                text = { Text(stringResource(R.string.new_chat)) },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.sharedBounds(rememberSharedContentState("chat-new"), visibility),
            )
        },
    ) { pad ->
        val list = chats
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = pad.calculateTopPadding(), bottom = 120.dp, start = 16.dp, end = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (pending.isNotEmpty()) item("approvals") {
                Surface(
                    onClick = openApprovals,
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.fillMaxWidth().animateContentSize(),
                ) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        GenteMark(size = 22.dp, thinking = true)
                        Spacer(Modifier.width(12.dp))
                        Text(
                            if (pending.size == 1) stringResource(R.string.pending_approval_one) else stringResource(R.string.pending_approvals, pending.size),
                            style = MaterialTheme.typography.titleSmall,
                        )
                    }
                }
            }
            if (list != null && list.isEmpty()) item("empty") { EmptyHome(onSuggestion = { newChat(it) }) }
            items(list.orEmpty(), key = { it.id }) { c ->
                var menu by remember { mutableStateOf(false) }
                Box {
                    ChatRow(
                        c,
                        Modifier
                            .sharedBounds(rememberSharedContentState("chat-${c.id}"), visibility)
                            .animateItem()
                            .combinedClickable(onClick = { openChat(c.id) }, onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); menu = true }),
                    )
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.delete_chat)) }, onClick = {
                            menu = false
                            scope.launch { graph.dao.deleteMessages(c.id); graph.dao.deleteChat(c.id) }
                        })
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatRow(c: ChatSummary, modifier: Modifier) {
    Surface(modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (c.pinned) { Icon(Icons.Rounded.PushPin, stringResource(R.string.pinned), Modifier.size(14.dp)); Spacer(Modifier.width(6.dp)) }
                Text(
                    c.title.ifBlank { stringResource(R.string.untitled_chat) },
                    style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                Text(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(c.updatedAt)), style = MaterialTheme.typography.labelSmall, color = LocalGenteExtras.current.muted)
            }
            c.lastText?.let {
                Spacer(Modifier.height(2.dp))
                Text(it.replace('\n', ' '), style = MaterialTheme.typography.bodyMedium, color = LocalGenteExtras.current.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun EmptyHome(onSuggestion: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 48.dp, bottom = 24.dp), horizontalAlignment = Alignment.Start) {
        Text(stringResource(R.string.empty_chats_title), style = MaterialTheme.typography.headlineMedium)
        Squiggle(Modifier.width(96.dp).height(10.dp).padding(start = 2.dp))
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.empty_chats_body), style = MaterialTheme.typography.bodyLarge, color = LocalGenteExtras.current.muted)
        Spacer(Modifier.height(24.dp))
        listOf(R.string.suggest_1, R.string.suggest_2, R.string.suggest_3).forEach { r ->
            val s = stringResource(r)
            Surface(
                Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable { onSuggestion(s) },
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceContainer,
            ) { Text(s, Modifier.padding(16.dp), style = MaterialTheme.typography.bodyLarge) }
        }
    }
}
