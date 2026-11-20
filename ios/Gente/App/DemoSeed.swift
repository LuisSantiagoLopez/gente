// Copyright 2026 DeskHead Inc.
// Test-only sample data for UI tests and store screenshots (launch argument -GenteSeed).
import Foundation

enum DemoSeed {
    static func seed() {
        let s = EncryptedStore.shared
        guard s.chats().isEmpty else { return }
        let lang = Locale.current.language.languageCode?.identifier ?? "en"
        let t = texts[lang] ?? texts["en"]!
        for (i, c) in t.chats.enumerated() {
            var chat = Chat(title: c.title)
            chat.updatedAt = Date().addingTimeInterval(Double(-i) * 5400)
            chat.createdAt = chat.updatedAt
            s.saveChat(chat)
            var at = chat.createdAt.addingTimeInterval(-120)
            for (j, line) in c.lines.enumerated() {
                at = at.addingTimeInterval(20)
                s.saveMessage(Message(chatId: chat.id, role: j % 2 == 0 ? .user : .assistant, text: line, createdAt: at,
                                      answeredBy: j % 2 == 0 ? nil : (i == 2 ? .desktop : .cloud),
                                      sources: j == 1 && i == 0 ? [Source(title: "weather.gov", url: "https://weather.gov")] : nil,
                                      steps: j == 1 && i == 0 ? [t.step] : nil))
            }
        }
        for m in t.memories { s.saveBrain(BrainItem(kind: .memory, title: m, body: m)) }
        s.saveRoutine(Routine(title: t.routine, prompt: t.routine, hour: 8, minute: 0))
        let services: [(Service, Carries, String, Int, Int)] = [
            (.inference, .chatContext, "/v1/inference/chat/completions", 3_812, 1_204),
            (.search, .toolInput, "/v1/proxy/search", 88, 6_410),
            (.inference, .chatContext, "/v1/inference/chat/completions", 5_120, 2_033),
            (.account, .account, "/v1/me/plan", 0, 214),
            (.relay, .encrypted, "/v1/relay/send", 1_480, 12),
        ]
        for (k, x) in services.enumerated() {
            s.saveEgress(EgressRecord(at: Date().addingTimeInterval(Double(-k) * 300), service: x.0.rawValue, method: "POST",
                                      host: "gente-cloud.vercel.app", path: x.2, bytesOut: x.3, bytesIn: x.4, status: 200,
                                      carries: x.1.rawValue, stored: x.0 == .inference ? "Not stored" : (x.0 == .relay ? "Sealed; deleted once your device picks it up" : "Not stored by Gente")))
        }
    }

    struct T { var chats: [(title: String, lines: [String])]; var memories: [String]; var routine: String; var step: String }
    static let texts: [String: T] = [
        "en": T(chats: [
            ("Weekend in Mexico City", ["Will it rain in Mexico City this Saturday?",
                                        "Probably a little. Saturday looks warm, around 24°C, with a 40% chance of showers after 4 pm. Plan the walk in Chapultepec for the morning and keep an umbrella for later."]),
            ("Reply to Ana about the deck", ["Draft a short reply to Ana. Say the deck is great and ask to move our call to Thursday.",
                                             "Here's a draft:\n\nHi Ana, the deck looks great. Thank you! Could we move our call to Thursday? Any time after 10 works for me.\n\nWant me to send it from your Gmail? I'll ask before anything goes out."]),
            ("Taxes checklist", ["What do I still need for my taxes?", "From your notes: the 1099 from the bank and last year's return. Everything else is in your Taxes project."]),
        ], memories: ["Prefers short answers", "Lives in Mexico City", "Calls with Ana are on Tuesdays"], routine: "Morning brief at 8:00", step: "Searched the web"),
        "es": T(chats: [
            ("Fin de semana en CDMX", ["¿Va a llover en la Ciudad de México este sábado?",
                                       "Probablemente un poco. El sábado se ve cálido, unos 24 °C, con 40% de probabilidad de lluvia después de las 4 pm. Mejor el paseo en Chapultepec por la mañana y lleva paraguas para la tarde."]),
            ("Responder a Ana sobre la presentación", ["Escribe una respuesta corta a Ana. Dile que la presentación está muy bien y pide mover la llamada al jueves.",
                                                       "Aquí va un borrador:\n\nHola Ana, la presentación quedó muy bien. ¡Gracias! ¿Podemos mover la llamada al jueves? Me queda bien cualquier hora después de las 10.\n\n¿La envío desde tu Gmail? Te pregunto antes de enviar cualquier cosa."]),
            ("Lista para los impuestos", ["¿Qué me falta para los impuestos?", "Según tus notas: la constancia del banco y la declaración del año pasado. Lo demás está en tu proyecto Impuestos."]),
        ], memories: ["Prefiere respuestas cortas", "Vive en la Ciudad de México", "Las llamadas con Ana son los martes"], routine: "Resumen de la mañana a las 8:00", step: "Buscó en la web"),
        "pt": T(chats: [
            ("Fim de semana em São Paulo", ["Vai chover em São Paulo neste sábado?",
                                            "Provavelmente um pouco. O sábado deve ser quente, cerca de 26 °C, com 40% de chance de chuva depois das 16h. Faça o passeio no Ibirapuera de manhã e leve um guarda-chuva para a tarde."]),
            ("Responder a Ana sobre a apresentação", ["Escreva uma resposta curta para a Ana. Diga que a apresentação ficou ótima e peça para mudar a ligação para quinta.",
                                                      "Aqui está um rascunho:\n\nOi Ana, a apresentação ficou ótima. Obrigado! Podemos mudar nossa ligação para quinta? Qualquer horário depois das 10 funciona para mim.\n\nQuer que eu envie pelo seu Gmail? Eu pergunto antes de enviar qualquer coisa."]),
            ("Lista do imposto de renda", ["O que ainda falta para o imposto de renda?", "Pelas suas notas: o informe do banco e a declaração do ano passado. O resto está no seu projeto Imposto."]),
        ], memories: ["Prefere respostas curtas", "Mora em São Paulo", "As ligações com a Ana são às terças"], routine: "Resumo da manhã às 8:00", step: "Pesquisou na web"),
    ]
}
