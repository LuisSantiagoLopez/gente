package com.deskhead.gente

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.deskhead.gente.ui.components.GenteMark
import com.deskhead.gente.ui.components.Squiggle
import com.deskhead.gente.ui.theme.GenteTheme

/** 1024x500 feature graphic, rendered with the app's own font, colors and mark. */
class StoreArtActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (intent.getBooleanExtra("seed", false)) { DebugSeed.run(this); finish(); return }
        if (intent.getBooleanExtra("approval", false)) { DebugSeed.approval(this); finish(); return }
        setContent {
            GenteTheme(dark = false) {
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
                    Row(
                        Modifier.fillMaxWidth().aspectRatio(1024f / 500f).background(MaterialTheme.colorScheme.background).padding(horizontal = 40.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Start,
                    ) {
                        GenteMark(size = 104.dp)
                        Spacer(Modifier.width(26.dp))
                        Column {
                            Text("Gente", style = MaterialTheme.typography.displayMedium.copy(fontSize = 40.sp), color = MaterialTheme.colorScheme.onBackground)
                            Squiggle(Modifier.width(96.dp).height(10.dp))
                            Spacer(Modifier.height(10.dp))
                            Text(stringResource(R.string.welcome_title), style = MaterialTheme.typography.titleLarge.copy(fontSize = 18.sp), color = MaterialTheme.colorScheme.onBackground)
                            Text(stringResource(R.string.store_art_line), style = MaterialTheme.typography.bodyLarge.copy(fontSize = 14.sp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}
