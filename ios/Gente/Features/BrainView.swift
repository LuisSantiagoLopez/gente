// Copyright 2026 DeskHead Inc.
import SwiftUI

struct BrainView: View {
    @State private var kind: BrainKind = .memory
    @State private var items: [BrainItem] = []
    @State private var editing: BrainItem?

    var body: some View {
        List {
            Picker("", selection: $kind) {
                Text("Memory").tag(BrainKind.memory)
                Text("Skills").tag(BrainKind.skill)
                Text("Projects").tag(BrainKind.project)
                Text("Files").tag(BrainKind.file)
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            if items.isEmpty {
                Text(kind == .memory ? "Gente remembers what you ask it to. It all stays on this iPhone." : "Nothing here yet.")
                    .font(.gente(.body)).foregroundStyle(G.muted)
            }
            ForEach(items) { item in
                Button { editing = item } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title).font(.gente(.body, weight: .semibold))
                        if item.body != item.title { Text(item.body).font(.gente(.footnote)).foregroundStyle(G.muted).lineLimit(2) }
                    }
                }
                .foregroundStyle(G.foreground)
            }
            .onDelete { idx in
                for i in idx { EncryptedStore.shared.deleteBrain(items[i].id); SyncEngine.shared.publish("brain.delete", id: items[i].id, items[i].id) }
                reload()
            }
        }
        .scrollContentBackground(.hidden)
        .background(G.background)
        .navigationTitle("Memory and more")
        .toolbar {
            Button { editing = BrainItem(kind: kind, title: "", body: "") } label: { Image(systemName: "plus") }
                .accessibilityLabel(Text("Add"))
        }
        .onChange(of: kind) { _, _ in reload() }
        .task { reload() }
        .sheet(item: $editing) { item in
            BrainEditor(item: item) { saved in
                var s = saved; s.updatedAt = Date()
                EncryptedStore.shared.saveBrain(s)
                SyncEngine.shared.publish("brain.upsert", id: s.id, s)
                editing = nil; reload()
            }
        }
    }
    func reload() { items = EncryptedStore.shared.brain(kind) }
}

struct BrainEditor: View {
    @State var item: BrainItem
    var save: (BrainItem) -> Void
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                TextField(String(localized: "Title"), text: $item.title)
                TextField(String(localized: "Details"), text: $item.body, axis: .vertical).lineLimit(4...12)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { if item.body.isEmpty { item.body = item.title }; save(item) }.disabled(item.title.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

struct RoutinesView: View {
    @State private var routines: [Routine] = []
    @State private var editing: Routine?
    var body: some View {
        List {
            Section {
                Text("Routines remind you at a set time and run with one tap.").font(.gente(.footnote)).foregroundStyle(G.muted)
            }
            ForEach(routines) { r in
                HStack {
                    Button { editing = r } label: {
                        VStack(alignment: .leading) {
                            Text(r.title).font(.gente(.body, weight: .semibold))
                            Text(String(format: "%02d:%02d", r.hour, r.minute)).font(.gente(.footnote)).foregroundStyle(G.muted)
                        }
                    }.foregroundStyle(G.foreground)
                    Spacer()
                    Toggle("", isOn: Binding(get: { r.enabled }, set: { v in
                        var x = r; x.enabled = v; save(x)
                    })).labelsHidden().tint(G.primary)
                }
            }
            .onDelete { idx in
                for i in idx { NotificationScheduler.unschedule(routines[i]); EncryptedStore.shared.deleteRoutine(routines[i].id) }
                reload()
            }
        }
        .scrollContentBackground(.hidden)
        .background(G.background)
        .navigationTitle("Routines")
        .toolbar { Button { editing = Routine(title: "", prompt: "", hour: 8, minute: 0) } label: { Image(systemName: "plus") }.accessibilityLabel(Text("Add routine")) }
        .task { reload() }
        .sheet(item: $editing) { r in
            RoutineEditor(routine: r) { saved in
                Task { _ = await NotificationScheduler.requestPermission(); save(saved) }
                editing = nil
            }
        }
    }
    func save(_ r: Routine) { EncryptedStore.shared.saveRoutine(r); NotificationScheduler.schedule(r); reload() }
    func reload() { routines = EncryptedStore.shared.routines() }
}

struct RoutineEditor: View {
    @State var routine: Routine
    var save: (Routine) -> Void
    @Environment(\.dismiss) private var dismiss
    var time: Binding<Date> {
        Binding(get: { Calendar.current.date(bySettingHour: routine.hour, minute: routine.minute, second: 0, of: Date()) ?? Date() },
                set: { d in let c = Calendar.current.dateComponents([.hour, .minute], from: d); routine.hour = c.hour ?? 8; routine.minute = c.minute ?? 0 })
    }
    var body: some View {
        NavigationStack {
            Form {
                TextField(String(localized: "Name"), text: $routine.title)
                TextField(String(localized: "What should Gente do?"), text: $routine.prompt, axis: .vertical).lineLimit(3...8)
                DatePicker(String(localized: "Time"), selection: time, displayedComponents: .hourAndMinute)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save(routine) }.disabled(routine.title.isEmpty || routine.prompt.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
