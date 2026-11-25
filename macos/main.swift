// OdooRemember — app de barra de menú para la asistencia en Odoo.
//
// No habla con Odoo directamente: usa la API local (server/, Node) que corre en
// http://127.0.0.1:8787. Cada minuto consulta /api/attendance/today; la API decide
// qué recordatorio toca (entrada, comida, regreso de comida, salida) y esta app
// lo muestra como notificación con su botón de acción. También abre el panel web
// en una ventana nativa.
//
// Uso: OdooRemember --api http://127.0.0.1:8787

import Cocoa
import CoreLocation
import UserNotifications
import WebKit

// MARK: - Ubicación (CoreLocation)

struct Fix: Encodable {
    let latitude: Double
    let longitude: Double
    let accuracy: Double
    let city: String?
    let country: String?
    let at: String
}

/// Sigue la ubicación con Servicios de Ubicación (Wi-Fi) y la traduce a ciudad/país.
///
/// Usa seguimiento continuo (startUpdatingLocation): macOS avisa cuando cambia, así que
/// `latest` siempre es la mejor ubicación conocida. `requestLocation()` no se usa porque
/// en la Mac suele rendirse a los 10 s con "ubicación desconocida".
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private(set) var latest: CLLocation?
    private var waiters: [UUID: CheckedContinuation<CLLocation, Error>] = [:]
    private var cachedPlace: (location: CLLocation, city: String?, country: String?)?
    var onAuthorizationChange: (() -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 50
    }

    var status: CLAuthorizationStatus { manager.authorizationStatus }
    var authorized: Bool { status == .authorizedAlways || status == .authorized }

    func start() {
        if status == .notDetermined { manager.requestWhenInUseAuthorization() }
        if authorized { manager.startUpdatingLocation() }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if authorized { manager.startUpdatingLocation() }
        else if status == .denied || status == .restricted { failWaiters(Self.deniedError) }
        onAuthorizationChange?()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        latest = loc
        let w = waiters; waiters = [:]
        w.values.forEach { $0.resume(returning: loc) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // "Ubicación desconocida" es temporal: CoreLocation sigue intentando; los que esperan
        // reciben la última conocida al vencer su tiempo de espera.
        if (error as? CLError)?.code == .denied { failWaiters(Self.deniedError) }
    }

    private func failWaiters(_ error: Error) {
        let w = waiters; waiters = [:]
        w.values.forEach { $0.resume(throwing: error) }
    }

    static let deniedError = ApiError(error: "Sin permiso de ubicación. Actívalo en Configuración del Sistema → Privacidad y seguridad → Servicios de ubicación → Odoo Asistencia.")

    /// Ubicación actual: la conocida si es de los últimos 2 min; si no, espera una nueva hasta
    /// `timeout` s y, si no llega, usa la última conocida (el seguimiento continuo habría
    /// avisado si la Mac se hubiera movido).
    @MainActor
    private func location(timeout: TimeInterval) async throws -> CLLocation {
        if !authorized {
            start()
            if status == .denied || status == .restricted { throw Self.deniedError }
        }
        if let l = latest, -l.timestamp.timeIntervalSinceNow < 120 { return l }
        return try await withCheckedThrowingContinuation { cont in
            let id = UUID()
            waiters[id] = cont
            if authorized { manager.stopUpdatingLocation(); manager.startUpdatingLocation() }   // pedir una lectura nueva
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
                guard let self, let c = self.waiters.removeValue(forKey: id) else { return }
                if let l = self.latest { c.resume(returning: l) }
                else { c.resume(throwing: ApiError(error: "No se pudo obtener la ubicación. ¿Está activado el Wi-Fi?")) }
            }
        }
    }

    /// Ciudad y país, con tiempo límite (la geocodificación usa red).
    @MainActor
    private func place(for loc: CLLocation) async -> (String?, String?) {
        if let c = cachedPlace, c.location.distance(from: loc) < 500 { return (c.city, c.country) }
        return await withCheckedContinuation { cont in
            var done = false
            let finish: (String?, String?) -> Void = { city, country in
                if done { return }
                done = true
                cont.resume(returning: (city, country))
            }
            geocoder.reverseGeocodeLocation(loc, preferredLocale: Locale(identifier: "es_MX")) { [weak self] marks, _ in
                DispatchQueue.main.async {
                    guard let p = marks?.first else { finish(nil, nil); return }
                    let city = p.locality ?? p.subAdministrativeArea ?? p.administrativeArea
                    self?.cachedPlace = (loc, city, p.country)
                    finish(city, p.country)
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
                self?.geocoder.cancelGeocode()
                finish(nil, nil)
            }
        }
    }

    @MainActor
    func currentFix(timeout: TimeInterval = 15) async throws -> Fix {
        let loc = try await location(timeout: timeout)
        let (city, country) = await place(for: loc)
        // `at` = cuándo la app confirmó esta ubicación como la actual (no cuándo macOS la midió).
        return Fix(latitude: loc.coordinate.latitude, longitude: loc.coordinate.longitude,
                   accuracy: loc.horizontalAccuracy, city: city, country: country,
                   at: ISO8601DateFormatter().string(from: Date()))
    }
}

// MARK: - Modelo (subconjunto de server/types.ts)

struct Reminder: Decodable, Equatable {
    let kind: String
    let title: String
    let body: String
    let action: String
    let repeats: Bool
    enum CodingKeys: String, CodingKey { case kind, title, body, action, repeats = "repeat" }
}

struct Actions: Decodable { let checkIn, checkOut, lunchStart, lunchEnd: Bool }
struct Lunch: Decodable { let reason: String? }

struct Today: Decodable {
    let date: String
    let status: String
    let summary: String
    let actions: Actions
    let lunch: Lunch
    let reminder: Reminder?
    let reminderIntervalMinutes: Int
    let odooAttendanceUrl: String
}

struct ApiError: LocalizedError, Decodable {
    let error: String
    var errorDescription: String? { error }
}

// MARK: - Cliente de la API local

final class Api {
    let base: URL
    init(base: URL) { self.base = base }

    func sendLocation(_ fix: Fix) async throws {
        _ = try await raw("POST", "api/location", body: try JSONEncoder().encode(fix))
    }

    private func request(_ method: String, _ path: String) async throws -> Today {
        let data = try await raw(method, path, body: method == "GET" ? nil : Data("{}".utf8))
        return try JSONDecoder().decode(Today.self, from: data)
    }

    private func raw(_ method: String, _ path: String, body: Data?) async throws -> Data {
        var req = URLRequest(url: URL(string: path, relativeTo: base)!, timeoutInterval: 30)
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
        }
        let data: Data, resp: URLResponse
        do { (data, resp) = try await URLSession.shared.data(for: req) } catch {
            throw ApiError(error: "La API local no responde (\(base.absoluteString))")
        }
        if let http = resp as? HTTPURLResponse, http.statusCode >= 400 {
            throw (try? JSONDecoder().decode(ApiError.self, from: data)) ?? ApiError(error: "Error HTTP \(http.statusCode)")
        }
        return data
    }

    func today(fresh: Bool) async throws -> Today {
        try await request("GET", "api/attendance/today" + (fresh ? "?fresh=1" : ""))
    }
    func checkIn() async throws -> Today { try await request("POST", "api/attendance/check-in") }
    func checkOut() async throws -> Today { try await request("POST", "api/attendance/check-out") }
    func lunchStart() async throws -> Today { try await request("POST", "api/attendance/lunch/start") }
    func lunchEnd() async throws -> Today { try await request("POST", "api/attendance/lunch/end") }
}

// MARK: - App

let kActionCheckIn = "check_in"
let kActionCheckOut = "check_out"
let kActionLunchStart = "lunch_start"
let kActionLunchEnd = "lunch_end"
let kActionOpenOdoo = "open_odoo"
let kReminderId = "odoo-reminder"
let kResultId = "odoo-result"

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate, NSWindowDelegate {
    let api: Api
    let location = LocationProvider()
    var lastLocationPush: Date?
    var statusItem: NSStatusItem!
    let statusLine = NSMenuItem(title: "Consultando…", action: nil, keyEquivalent: "")
    let locationLine = NSMenuItem(title: "📍 Obteniendo ubicación…", action: nil, keyEquivalent: "")
    var items: [String: NSMenuItem] = [:]
    var timer: Timer?
    var panel: NSWindow?
    var refreshing = false
    var refreshStarted = Date.distantPast
    var lastShown: [String: Date] = [:]          // kind → última vez que se notificó
    var shownOnceDay: [String: String] = [:]     // kind → fecha (para recordatorios de una sola vez)
    var currentKind: String?

    init(api: Api) { self.api = api }

    func applicationDidFinishLaunching(_ n: Notification) {
        setupMainMenu()
        setupStatusMenu()
        setupNotifications()
        location.onAuthorizationChange = { [weak self] in
            Task { @MainActor in await self?.pushLocation() }
        }
        location.start()
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(self, selector: #selector(didWake), name: NSWorkspace.didWakeNotification, object: nil)
        ws.addObserver(self, selector: #selector(didWake), name: NSWorkspace.sessionDidBecomeActiveNotification, object: nil)
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.refresh() }
        // La API puede tardar unos segundos en levantar al iniciar sesión.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.refresh() }
    }

    // MARK: Menús

    /// Menú principal oculto: permite ⌘C/⌘V/⌘A/⌘W en la ventana del panel.
    func setupMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Cerrar ventana", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        appMenu.addItem(withTitle: "Recargar", action: #selector(reloadPanel), keyEquivalent: "r").target = self
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Editar"); editItem.submenu = edit
        edit.addItem(withTitle: "Deshacer", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Rehacer", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Pegar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Seleccionar todo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        NSApp.mainMenu = main
    }

    func setupStatusMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        setIcon("clock")
        let menu = NSMenu()
        menu.autoenablesItems = false
        statusLine.isEnabled = false
        menu.addItem(statusLine)
        locationLine.isEnabled = false
        menu.addItem(locationLine)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Abrir panel", action: #selector(openPanel), keyEquivalent: "p").target = self
        menu.addItem(.separator())
        for (key, title, sel) in [
            (kActionCheckIn, "Registrar entrada", #selector(menuCheckIn)),
            (kActionLunchStart, "Salir a comer", #selector(menuLunchStart)),
            (kActionLunchEnd, "Regresar de comer", #selector(menuLunchEnd)),
            (kActionCheckOut, "Registrar salida", #selector(menuCheckOut)),
        ] {
            let item = menu.addItem(withTitle: title, action: sel, keyEquivalent: "")
            item.target = self
            item.isEnabled = false
            items[key] = item
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "Actualizar estado", action: #selector(menuRefresh), keyEquivalent: "r").target = self
        menu.addItem(withTitle: "Abrir asistencias en Odoo", action: #selector(openOdoo), keyEquivalent: "o").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Salir", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
    }

    func setIcon(_ symbol: String) {
        let img = NSImage(systemSymbolName: symbol, accessibilityDescription: "Odoo asistencia")
        img?.isTemplate = true
        statusItem.button?.image = img
    }

    func show(_ t: Today) {
        odooAttendanceURL = t.odooAttendanceUrl
        statusLine.title = t.summary
        items[kActionCheckIn]?.isEnabled = t.actions.checkIn
        items[kActionCheckOut]?.isEnabled = t.actions.checkOut
        items[kActionLunchStart]?.isEnabled = t.actions.lunchStart
        items[kActionLunchStart]?.toolTip = t.lunch.reason
        items[kActionLunchEnd]?.isEnabled = t.actions.lunchEnd
        items[kActionLunchEnd]?.isHidden = !t.actions.lunchEnd
        switch t.status {
        case "working": setIcon("clock.badge.checkmark")
        case "lunch": setIcon("fork.knife")
        case "out": setIcon("checkmark.circle")
        default: setIcon("clock.badge.exclamationmark")
        }
    }

    @objc func menuCheckIn() { perform(kActionCheckIn) }
    @objc func menuCheckOut() { perform(kActionCheckOut) }
    @objc func menuLunchStart() { perform(kActionLunchStart) }
    @objc func menuLunchEnd() { perform(kActionLunchEnd) }
    @objc func menuRefresh() { refresh(force: true) }
    @objc func didWake() { refresh(force: true) }
    @objc func openOdoo() {
        if let s = odooAttendanceURL, let url = URL(string: s) { NSWorkspace.shared.open(url) }
    }
    var odooAttendanceURL: String?

    // MARK: Ventana del panel

    @objc func openPanel() {
        if panel == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            w.title = "Odoo Asistencia"
            w.isReleasedWhenClosed = false
            w.delegate = self
            w.setFrameAutosaveName("OdooRememberPanel")
            if !w.setFrameUsingName("OdooRememberPanel") { w.center() }
            let web = WKWebView(frame: w.contentView!.bounds)
            web.autoresizingMask = [.width, .height]
            web.uiDelegate = self
            web.navigationDelegate = self
            w.contentView = web
            web.load(URLRequest(url: api.base))
            panel = w
        } else {
            reloadPanel()
        }
        NSApp.setActivationPolicy(.regular)          // mostrar en el Dock y ⌘Tab mientras está abierta
        NSApp.activate(ignoringOtherApps: true)
        panel?.makeKeyAndOrderFront(nil)
    }

    @objc func reloadPanel() { (panel?.contentView as? WKWebView)?.reload() }

    func windowWillClose(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }

    // MARK: Notificaciones

    func setupNotifications() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        func category(_ action: String, _ title: String, foreground: Bool = false) -> UNNotificationCategory {
            UNNotificationCategory(identifier: action,
                                   actions: [UNNotificationAction(identifier: action, title: title, options: foreground ? [.foreground] : [])],
                                   intentIdentifiers: [], options: [])
        }
        center.setNotificationCategories([
            category(kActionCheckIn, "Registrar entrada"),
            category(kActionCheckOut, "Registrar salida"),
            category(kActionLunchStart, "Salir a comer"),
            category(kActionLunchEnd, "Registrar regreso"),
            category(kActionOpenOdoo, "Abrir panel", foreground: true),
        ])
        center.requestAuthorization(options: [.alert, .sound]) { granted, err in
            if !granted { NSLog("OdooRemember: notificaciones no autorizadas \(err?.localizedDescription ?? "")") }
        }
    }

    func notify(id: String, title: String, body: String, category: String? = nil, sound: Bool = true) {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        if let category { c.categoryIdentifier = category }
        if sound { c.sound = .default }
        c.interruptionLevel = .timeSensitive
        let center = UNUserNotificationCenter.current()
        center.removeDeliveredNotifications(withIdentifiers: [id])
        center.add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let action = response.actionIdentifier
        DispatchQueue.main.async { [self] in
            if action == kActionOpenOdoo { openPanel() }
            else if [kActionCheckIn, kActionCheckOut, kActionLunchStart, kActionLunchEnd].contains(action) { perform(action) }
            completionHandler()
        }
    }

    // MARK: Lógica

    func refresh(force: Bool = false) {
        // Si una revisión anterior se quedó colgada más de 2 min, no bloquear las siguientes.
        if refreshing && Date().timeIntervalSince(refreshStarted) < 120 { return }
        refreshing = true
        refreshStarted = Date()
        Task { @MainActor in
            defer { refreshing = false }
            // Mantener una ubicación reciente en la API (cada 5 min o al despertar).
            if force || lastLocationPush.map({ Date().timeIntervalSince($0) > 5 * 60 }) ?? true {
                await pushLocation()
            }
            do {
                let t = try await api.today(fresh: force)
                show(t)
                handleReminder(t)
            } catch {
                statusLine.title = error.localizedDescription
                setIcon("exclamationmark.triangle")
            }
        }
    }

    @MainActor
    func handleReminder(_ t: Today) {
        guard let r = t.reminder else {
            if currentKind != nil { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [kReminderId]) }
            currentKind = nil
            return
        }
        if r.kind != currentKind { lastShown[r.kind] = nil }   // cambió el tipo de recordatorio: avisar ya
        currentKind = r.kind
        let now = Date()
        if r.repeats {
            if let last = lastShown[r.kind], now.timeIntervalSince(last) < Double(t.reminderIntervalMinutes * 60) - 5 { return }
        } else {
            if shownOnceDay[r.kind] == t.date { return }
            shownOnceDay[r.kind] = t.date
        }
        lastShown[r.kind] = now
        notify(id: kReminderId, title: r.title, body: r.body, category: r.action)
    }

    /// Obtiene la ubicación y la manda a la API. Devuelve el error si no se pudo.
    @MainActor @discardableResult
    func pushLocation() async -> Error? {
        do {
            let fix = try await location.currentFix()
            try await api.sendLocation(fix)
            lastLocationPush = Date()
            let place = [fix.city, fix.country].compactMap { $0 }.joined(separator: ", ")
            locationLine.title = "📍 \(place.isEmpty ? "Ubicación lista" : place) (±\(Int(fix.accuracy)) m)"
            return nil
        } catch {
            locationLine.title = "⚠️ Sin ubicación: \(error.localizedDescription)"
            return error
        }
    }

    func perform(_ action: String) {
        Task { @MainActor in
            // La ubicación es obligatoria: tomar una fresca justo antes de registrar.
            let locationError = await pushLocation()
            do {
                let t: Today
                let msg: String
                switch action {
                case kActionCheckIn: t = try await api.checkIn(); msg = "Entrada registrada ✅"
                case kActionCheckOut: t = try await api.checkOut(); msg = "Salida registrada 👋"
                case kActionLunchStart: t = try await api.lunchStart(); msg = "Salida a comer registrada 🍽️"
                case kActionLunchEnd: t = try await api.lunchEnd(); msg = "Regreso de comida registrado ✅"
                default: return
                }
                UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [kReminderId])
                currentKind = nil
                show(t)
                notify(id: kResultId, title: msg, body: t.summary, sound: false)
                reloadPanel()
            } catch {
                // Si falló por falta de ubicación, mostrar la causa real (permiso, Wi-Fi…).
                let msg = locationError.map { "\(error.localizedDescription)\n\($0.localizedDescription)" } ?? error.localizedDescription
                notify(id: kResultId, title: "No se pudo completar", body: msg, category: kActionOpenOdoo)
            }
        }
    }
}

// Abrir enlaces externos (p. ej. "Abrir en Odoo") en el navegador, no dentro del panel.
extension AppDelegate: WKUIDelegate, WKNavigationDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, url.host != api.base.host, navigationAction.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "Aceptar")
        alert.addButton(withTitle: "Cancelar")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }
}

// MARK: - Entrada

func argValue(_ name: String) -> String? {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
    return a[i + 1]
}

let apiURL = URL(string: argValue("--api") ?? "http://127.0.0.1:8787")!
let app = NSApplication.shared
let delegate = AppDelegate(api: Api(base: apiURL))
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
