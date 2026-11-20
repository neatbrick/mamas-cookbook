import UIKit
import UniformTypeIdentifiers

private let appGroup = "group.com.mamascookbook.shared"
private let pendingKey = "pendingSafariRecipe"

final class ShareViewController: UIViewController {
    private let status = UILabel()
    private let openButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let title = UILabel()
        title.text = "Save to Mama's Cookbook"
        title.font = .preferredFont(forTextStyle: .title2)
        title.textAlignment = .center
        status.text = "Reading recipe from Safari…"
        status.numberOfLines = 0
        status.textAlignment = .center
        openButton.setTitle("Open Mama's Cookbook", for: .normal)
        openButton.addTarget(self, action: #selector(openCookbook), for: .touchUpInside)
        openButton.isEnabled = false
        let stack = UIStackView(arrangedSubviews: [title, status, openButton])
        stack.axis = .vertical
        stack.spacing = 22
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        extractSharedContent()
    }

    private func extractSharedContent() {
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier, options: nil) { [weak self] item, error in
                let dictionary = item as? [String: Any]
                let safari = dictionary?[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any]
                self?.store(safari)
            }
        } else if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] item, _ in
                let url = (item as? URL)?.absoluteString ?? ""
                self?.store(["url": url, "title": "Shared recipe"])
            }
        } else {
            status.text = "Open a recipe page in Safari, tap Share, then choose Save to Mama's Cookbook."
        }
    }

    private func store(_ data: [String: Any]?) {
        guard let data else {
            DispatchQueue.main.async { self.status.text = "Could not read the Safari page." }
            return
        }
        let recipe = data["recipe"] as? [String: Any]
        let url = data["url"] as? String ?? ""
        let name = recipe?["name"] as? String ?? data["title"] as? String ?? "Shared recipe"
        let ingredients = recipe?["recipeIngredient"] as? [String] ?? []
        let instructionsRaw = recipe?["recipeInstructions"] as? [Any] ?? []
        func instructionText(_ value: Any) -> String {
            if let text = value as? String { return text }
            if let dict = value as? [String: Any] { return dict["text"] as? String ?? "" }
            return ""
        }
        let instructions = instructionsRaw.map(instructionText).filter { !$0.isEmpty }
        // Store a normalized payload; the web app can display its existing save confirmation.
        let payload: [String: Any] = [
            "title": name, "sourceUrl": url,
            "ingredients": ingredients, "instructions": instructions
        ]
        guard let json = try? JSONSerialization.data(withJSONObject: payload),
              let encoded = String(data: json, encoding: .utf8)?.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let defaults = UserDefaults(suiteName: appGroup) else {
            DispatchQueue.main.async { self.status.text = "Could not prepare shared recipe." }
            return
        }
        defaults.set(encoded, forKey: pendingKey)
        DispatchQueue.main.async {
            self.status.text = ingredients.isEmpty || instructions.isEmpty
                ? "Link saved. This site did not expose a complete recipe; you may need to import it from the page."
                : "Recipe ready: \(name). Open Mama's Cookbook to review and save."
            self.openButton.isEnabled = true
        }
    }

    @objc private func openCookbook() {
        guard let url = URL(string: "mamascookbook://shared") else { return }
        extensionContext?.open(url) { [weak self] opened in
            DispatchQueue.main.async {
                if !opened {
                    self?.status.text = "Recipe queued. Close this sheet and open Mama's Cookbook from your Home Screen."
                } else {
                    self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                }
            }
        }
    }
}
