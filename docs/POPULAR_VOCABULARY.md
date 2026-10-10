# Built-in company and technical vocabulary

Wordwarden includes a small curated vocabulary for common company, product, and technical names. It works entirely offline, alongside the packaged English dictionaries. It is not a live company directory and cannot recognize every new brand.

## Behavior

- Recognize approved names, including lowercase variants such as `openai`, `spacex`, and `chatgpt`.
- Preserve canonical mixed casing when a known name is offered as a spelling suggestion, such as `OpenAI` or `SpaceX`.
- Continue checking nearby misspellings. Unknown capitalized words are not automatically accepted.
- Keep personal dictionary storage, counts, export, and reset separate from built-in vocabulary.
- Make no automatic text replacements or network vocabulary lookups.

The authoritative list is `src/core/popular-vocabulary.ts`. The feature does not suppress unrelated grammar or punctuation checks.

## Curation and provenance

Entries are individually selected names, not an imported third-party dictionary or scraped dataset. Official naming references for the initial set:

| Names | Naming reference |
| --- | --- |
| Airbnb | https://www.airbnb.com/ |
| Android | https://www.android.com/ |
| ChatGPT, OpenAI | https://openai.com/ |
| Docker | https://www.docker.com/ |
| GitHub | https://github.com/ |
| GitLab | https://about.gitlab.com/ |
| GraphQL | https://graphql.org/ |
| iOS, iPad, iPhone, macOS | https://www.apple.com/ |
| Kubernetes | https://kubernetes.io/ |
| LinkedIn | https://www.linkedin.com/ |
| MongoDB | https://www.mongodb.com/ |
| Netflix | https://www.netflix.com/ |
| PostgreSQL | https://www.postgresql.org/ |
| Shopify | https://www.shopify.com/ |
| SpaceX | https://www.spacex.com/ |
| Spotify | https://www.spotify.com/ |
| TikTok | https://www.tiktok.com/ |
| TypeScript | https://www.typescriptlang.org/ |
| WhatsApp | https://www.whatsapp.com/ |
| YouTube | https://www.youtube.com/ |

References identify the owners' naming sources; they are not runtime dependencies or endorsements. Names remain their owners' trademarks where applicable.

## Adding terms

1. Check the existing packaged runtime first; canonical names may already be known while lowercase variants are not.
2. Prefer established, distinctive, single-token names with official spelling references. Avoid generic words such as apple, meta, or notion as brand-specific overrides.
3. Add a failing recognition or candidate-ranking regression before changing the vocabulary.
4. Verify all four dialects, case variants, possessives, nearby true typos, and ordinary-word suggestion ranking. Do not accept arbitrary suffixes or substrings.
5. Keep built-in vocabulary out of persistent user settings. Do not broaden the list using user text or telemetry.
6. Run compile, unit tests, a fresh build, and packaged E2E tests. Update this reference table with new entries.

Unknown names can still be added to the personal dictionary. Multiword entity recognition, automatic online updates, and exhaustive company coverage are outside this feature's scope.
