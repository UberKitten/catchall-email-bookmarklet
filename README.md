# catch-all email bookmarklet

Generate a bookmarklet that creates timestamped email addresses for your
catch-all domain, with hostnames normalized via the [Public Suffix List][psl]
(so `accounts.google.com` becomes `google.com` and `foo.bar.co.uk` becomes
`bar.co.uk`).

The timestamp is encoded as base36 unix seconds &mdash; so the address itself
records when it was generated, with no database or storage required.

**Live:** <https://catchall-email-bookmarklet.uberkitten.com>

## How it works

1. The generator page fetches the full PSL from jsDelivr and inlines it into
   the bookmarklet source as a string literal.
2. The generated bookmarklet is fully self-contained: it runs in the target
   page's JS context with no network activity, which avoids CSP issues on
   locked-down sites.
3. Clicking the bookmarklet reads `location.hostname`, applies PSL rules to
   get the registrable domain, appends a base36 unix timestamp, and copies
   the resulting address to the clipboard.

## Decoder

Paste any previously-generated address into the decoder to recover the
original domain and creation timestamp.

## Dev

Plain static HTML/CSS/JS. No build step. Open `index.html` in a browser.

## License

MIT.

[psl]: https://publicsuffix.org/
