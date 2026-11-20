# Mama's Cookbook — native iOS Safari sharing

This folder contains a native iPhone wrapper and a Safari Share Extension. The extension reads recipe JSON-LD **inside Safari** using `NSExtensionJavaScriptPreprocessingFile`, normalizes the recipe, and passes it to the main app using an App Group. The main app opens the existing PWA with its `#sharedRecipe` handler and confirmation.

## Build on a Mac
1. Install Xcode and XcodeGen (`brew install xcodegen`).
2. In this folder, run `xcodegen generate`; open `MamasCookbook.xcodeproj` in Xcode.
3. In Signing & Capabilities, choose your Apple Developer team for **both** targets. Change the bundle IDs and App Group ID in project.yml, both entitlement files, and both Swift files to IDs registered to your team.
4. Ensure the Share Extension includes `RecipePreprocessor.js` in its Copy Bundle Resources build phase (XcodeGen includes resources from its source directory).
5. Build to your iPhone, open Safari on a recipe page, Share → More → **Save to Mama's Cookbook**.
6. Tap **Open Mama's Cookbook**; if iOS doesn't allow opening the app from the extension, dismiss Share and launch Mama's Cookbook manually. The pending recipe remains queued.

## Limitations
- This is source code, **not** an installed or App Store-distributed iPhone app. A Mac/Xcode and Apple signing are required to run it.
- Safari JavaScript preprocessing may be unavailable in some share contexts. The extension falls back to sharing the URL.
- Recipe JSON-LD can use varied shapes; this starter supports common ingredient arrays and instruction strings/HowToSteps. Some sites will require more parsing.
- Web app sign-in in WKWebView may behave differently from Safari; Google OAuth and associated domains should be tested on a real device.
- The extension does not bypass authentication, paywalls, or browser security.
