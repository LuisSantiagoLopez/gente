package com.deskhead.gente

import android.content.Context
import com.deskhead.gente.data.ChatEntity
import com.deskhead.gente.data.MemoryEntity
import com.deskhead.gente.data.MessageEntity
import kotlinx.coroutines.runBlocking

/** Debug builds only. Sample chats for store screenshots, typed into the real database and UI. */
object DebugSeed {
    fun run(ctx: Context) = runBlocking {
        val d = ctx.graph.dao
        val now = System.currentTimeMillis()
        val es = ctx.resources.configuration.locales[0].language
        val chats = when (es) {
            "es" -> listOf(
                Triple("Fin de semana en CDMX", "Planea un fin de semana tranquilo en la Ciudad de México", "Claro. Sábado: desayuno en Roma Norte, Museo Frida Kahlo a las 11 y paseo por Coyoacán. Domingo: bici en Reforma y comida en el mercado de San Juan. ¿Reservo algo?"),
                Triple("Respuesta al casero", "Escribe una respuesta amable a mi casero sobre la fuga", "Hola Jorge, gracias por avisar. El jueves después de las 5 me queda perfecto para que venga el plomero. Saludos."),
                Triple("Paneles solares", "¿Qué hay de nuevo en paneles solares este año?", "Tres cosas: celdas de perovskita más baratas, inversores más pequeños y baterías de sodio para casas."),
            )
            "pt" -> listOf(
                Triple("Fim de semana em SP", "Planeje um fim de semana tranquilo em São Paulo", "Claro. Sábado: café na Vila Madalena, Pinacoteca às 11 e passeio no Ibirapuera. Domingo: Avenida Paulista aberta e almoço no Mercadão. Quer que eu reserve algo?"),
                Triple("Resposta ao locador", "Escreva uma resposta gentil para o meu locador sobre o vazamento", "Oi Jorge, obrigado pelo aviso. Quinta depois das 17h fica ótimo para o encanador vir. Abraço."),
                Triple("Painéis solares", "O que há de novo em painéis solares este ano?", "Três coisas: células de perovskita mais baratas, inversores menores e baterias de sódio para casas."),
            )
            else -> listOf(
                Triple("Weekend in Mexico City", "Plan a calm weekend in Mexico City", "Sure. Saturday: breakfast in Roma Norte, the Frida Kahlo Museum at 11, then a walk around Coyoacán. Sunday: bikes on Reforma and lunch at San Juan market. Want me to book anything?"),
                Triple("Reply to landlord", "Write a kind reply to my landlord about the leak", "Hi Jorge, thanks for the heads-up. Thursday after 5 works well for the plumber. Best, Ana"),
                Triple("Solar panels", "What is new in solar panels this year?", "Three things: cheaper perovskite cells, smaller inverters, and sodium batteries for homes."),
            )
        }
        chats.forEachIndexed { i, (title, q, a) ->
            val id = "seed-$i"
            val t = now - i * 3_600_000L
            d.upsertChat(ChatEntity(id, title, t, t))
            d.upsertMessage(MessageEntity("$id-u", id, "user", q, t))
            if (i == 2) d.upsertMessage(MessageEntity("$id-t", id, "tool", "search:solar panels 2026", t + 1))
            d.upsertMessage(MessageEntity("$id-a", id, "assistant", a, t + 2, ranOn = if (i == 1) "desktop" else "cloud"))
        }
        d.upsertMemory(MemoryEntity("seed-m", "Ana likes quiet mornings", now))
        ctx.graph.settings.setOnboarded()
    }

    fun approval(ctx: Context) = runBlocking {
        val title = when (ctx.resources.configuration.locales[0].language) {
            "es" -> "Pagar 12 USD por el dominio gente-viaje.app"; "pt" -> "Pagar 12 USD pelo domínio gente-viagem.app"; else -> "Pay 12 USD for the domain gente-trip.app"
        }
        ctx.graph.approvals.record("seed-approval", "money", title, "Item: gente-trip.app\nAmount: 12 USD", "phone")
    }
}
