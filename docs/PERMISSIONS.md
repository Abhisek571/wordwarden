# Permission Explanation

- `storage`: saves local settings, dictionary words, and ignored issue hashes.
- `activeTab`: lets the popup show and change the enabled state of the current
  site after the user opens the popup.
- `<all_urls>`: lets Wordwarden find supported editable fields across websites.
  It does not grant Wordwarden a server and does not change local processing.

Wordwarden excludes password, payment, one-time-code, and explicitly private
fields. A site can be disabled from the popup or options page.
