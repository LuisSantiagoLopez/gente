package com.deskhead.gente.widget

import android.content.Context
import android.content.Intent
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.deskhead.gente.MainActivity
import com.deskhead.gente.R

/** Home-screen widget: one tap opens a new private chat. Shows no chat content. */
class AskWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val open = Intent(context, MainActivity::class.java).setAction(MainActivity.ACTION_ASK).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        provideContent {
            Row(
                GlanceModifier.fillMaxSize().cornerRadius(28.dp).background(ColorProvider(R.color.widget_bg)).padding(horizontal = 18.dp)
                    .clickable(actionStartActivity(open)),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Image(ImageProvider(R.drawable.ic_mark), null, GlanceModifier.size(30.dp))
                Spacer(GlanceModifier.width(12.dp))
                Text(context.getString(R.string.widget_ask), style = TextStyle(color = ColorProvider(R.color.widget_fg), fontSize = 18.sp, fontWeight = FontWeight.Bold))
            }
        }
    }
}

class AskWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = AskWidget()
}

