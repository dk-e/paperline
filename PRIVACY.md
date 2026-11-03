# Paperline privacy policy

Effective date: 3 November 2026

Paperline is a Chrome PDF viewer and annotation editor published by dan ([dk-e](https://github.com/dk-e)). Contact: [d@niel.lol](mailto:d@niel.lol).

## What Paperline handles

Paperline processes PDF files you open, their filenames and source addresses, text and other annotations you add, and the settings needed to operate the editor. To open PDFs automatically, it handles PDF link clicks, document-navigation addresses and request methods, and metadata about completed downloads such as their filenames, source URLs, MIME types, and completion/safety state. Drawing and text-placement coordinates are used only to create your annotations.

This data is processed on your device. Paperline does not send documents, edits, browsing activity, download information, or settings to the developer or to a developer-operated server. It has no analytics, advertising, tracking pixels, or account system.

## Network requests and signed-in websites

When you open an online PDF, Paperline requests it from its original website. The website receives the normal request information that your browser sends, such as your IP address and applicable request headers. The browser may automatically include your existing site cookies so you can open documents on signed-in services such as Moodle. Paperline does not ask for, read, or store your passwords or cookie values.

Authenticated PDF links may be fetched within the original website's context and transferred locally to the extension. Moodle resource pages may be inspected locally to find the requested PDF embed or download link. PDF content is not uploaded to a conversion service. Fonts, PDF rendering code, and other executable extension resources are bundled with the extension.

## Local storage and retention

- **Recovery draft:** the latest PDF you open, its filename, annotations, and a draft timestamp are saved in the extension's local IndexedDB. A draft remains until you replace it by opening another document, delete it on the start screen, clear the extension's data, or uninstall the extension.
- **Authenticated handoff:** PDF bytes fetched from a signed-in page are temporarily stored in extension-local IndexedDB. A consumed handoff is removed when the editor reads it. Unconsumed handoffs expire after ten minutes and are removed during subsequent handoff cleanup. Incomplete transfers are held in memory and cleaned up during later transfers or when the background worker stops.
- **Preferences:** automatic-opening preferences and setup status are stored in Chrome's local extension storage. They remain until changed or the extension's data is removed.
- **Session state:** download deduplication identifiers are kept in Chrome's session storage. Recent document request-method information is kept in memory to avoid replaying form submissions; it is cleared when its tab closes or the background worker stops. Paperline does not maintain a browsing-history database.
- **Exported files:** saved PDFs remain in the download location you choose. They contain your annotations, their editable Paperline properties, and the source PDF's existing content and metadata. Removing Paperline does not delete files you downloaded.

Paperline uses local extension storage, not Chrome's cross-device storage sync API. Your operating system's or browser profile's own backup mechanisms may independently include local files or browser data.

## Sharing and use

The developer does not receive or sell your data. Paperline does not share it with advertisers, data brokers, or analytics providers, and does not use it for advertising, creditworthiness, or unrelated purposes. Its use of data is limited to opening, displaying, annotating, exporting, and recovering PDFs and maintaining the settings required for those features.

Requests to the original document website remain subject to that website's privacy policy. Chrome, Google, and any operating-system backup services operate under their own policies. Installing Paperline through the Chrome Web Store does not give its developer access to your local documents or drafts.

## Your controls

Use **… → Paperline settings** to disable automatic PDF link opening or automatic download opening independently. Chrome's extension details let you control site access and local-file access. You can also open a PDF manually using the file picker or drag and drop.

Delete the recovery draft using the × beside it on the start screen. Uninstalling the extension removes its local extension storage. You can delete exported PDFs separately using your operating system's file manager.

## Changes and contact

If Paperline's data practices change, this policy and its effective date will be updated. For privacy questions, contact [d@niel.lol](mailto:d@niel.lol).
