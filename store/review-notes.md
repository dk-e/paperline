# Reviewer information for Paperline 1.4.0

## Single purpose

View and annotate PDFs in Chrome, including automatically opening PDF links and completed PDF downloads in the same editor.

## Permission justifications

- **activeTab:** inspect the current tab's PDF address when the user invokes the toolbar action.
- **contextMenus:** provide “Edit PDF in Paperline” on PDF/document links.
- **storage:** save editor preferences, automatic-opening state, setup errors, and session-only download deduplication identifiers. PDF recovery itself uses local IndexedDB.
- **downloads:** detect completion of PDF downloads and locate their local file/source URL. Non-PDF downloads are ignored. The extension does not delete or alter download records or files.
- **declarativeNetRequestWithHostAccess:** redirect PDF document navigations to the packaged editor, using URL and PDF response headers. Editor source fetches are excluded from these rules to prevent redirect loops.
- **webNavigation:** detect PDF navigations that escaped declarative redirects and open the packaged viewer rather than leaving Chrome's native viewer active.
- **webRequest:** observe request method and URL for document navigations, to avoid replaying POST responses. These observations are not used to build or transmit browsing history.
- **scripting:** install the PDF-link handler into already-open permitted pages after install/update, and route a PDF frame to the editor when a fallback is needed.
- **http://*/* and https://*/*:** users may open PDFs from any website. These permissions support automatic PDF detection, fetching the requested PDF, and preserving the same-site login context for authenticated resources.
- **file:///*:** read local/downloaded PDFs and handle local PDF navigation, subject to Chrome's separate “Allow access to file URLs” switch.

## User data handling

The privacy policy explicitly describes local PDF content, edits, file names, document URLs, download metadata, and annotation interactions. Relevant dashboard categories are website content, web history/document URLs, and user activity needed for annotations. These are handled locally for the single stated purpose, not transmitted to the developer, sold, used for ads, or used for creditworthiness.

Paperline does not have a login system or request credentials. Existing site cookies may accompany ordinary browser fetches of protected PDFs; the extension does not read or store cookie values.

No remote hosted code is used. JavaScript, the PDF worker, WebAssembly image decoders, fonts, and character maps are packaged. WebAssembly is used by bundled PDF.js decoders. User PDF documents are rendered as data; website HTML parsed to locate a Moodle PDF embed is not executed as code.

## How to test

1. Install the uploaded package. No account or payment is required to use Paperline.
2. Click the toolbar icon. Choose “Try a sample PDF”. The sample is bundled and contains no user data.
3. Choose the text tool (T), click on a blank area, and type. Finish with Escape. Use the floating palette to format the box. Drag its handle or resize from its lower-right corner.
4. Save PDF, then open the saved file through the file picker. Its Paperline text remains editable.
5. Check highlight (H), draw (D), undo/redo, and the optional page navigator.
6. Visit a public PDF URL in another tab. It should open in Paperline automatically. Test a completed PDF download with local-file access enabled, if available in the review environment.
7. Open “… → Paperline settings”. Test the two independent automatic-opening switches and the setup repair button.

Authenticated Moodle support is an optional integration using the user's existing website session. It is not necessary to access a university account to test the core extension. The repository's automated fixtures reproduce SameSite/HttpOnly cookies, original-page referrers, Moodle resource redirects and embeds, multi-chunk transfer, missing redirect rules, download fallback, and browser restarts. The publisher does not supply or request university credentials.

## Package

Upload `release/paperline-1.4.0-chrome-web-store.zip`, which has `manifest.json` at the ZIP root. The ordinary `paperline-1.4.0.zip` includes a `dist/` parent folder and is intended for manual unpacked installation only.
