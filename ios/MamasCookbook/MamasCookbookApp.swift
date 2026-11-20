import SwiftUI
import WebKit

private let appGroup = "group.com.mamascookbook.shared"
private let pendingKey = "pendingSafariRecipe"
private let cookbookURL = URL(string: "https://recipe-keeper-9uls.onrender.com/")!

@main
struct MamasCookbookApp: App {
    @State private var reloadToken = UUID()
    var body: some Scene {
        WindowGroup {
            CookbookWebView(reloadToken: reloadToken)
                .ignoresSafeArea(edges: .bottom)
                .onOpenURL { _ in reloadToken = UUID() }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                    if UserDefaults(suiteName: appGroup)?.string(forKey: pendingKey) != nil {
                        reloadToken = UUID()
                    }
                }
        }
    }
}

struct CookbookWebView: UIViewRepresentable {
    let reloadToken: UUID
    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        view.allowsBackForwardNavigationGestures = true
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.lastToken != reloadToken else { return }
        context.coordinator.lastToken = reloadToken
        var url = cookbookURL
        if let defaults = UserDefaults(suiteName: appGroup),
           let encoded = defaults.string(forKey: pendingKey) {
            defaults.removeObject(forKey: pendingKey)
            // The web app already handles #sharedRecipe= with a save confirmation.
            url = URL(string: cookbookURL.absoluteString + "#sharedRecipe=" + encoded) ?? cookbookURL
        }
        view.load(URLRequest(url: url))
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    class Coordinator {
        var lastToken: UUID?
    }
}
