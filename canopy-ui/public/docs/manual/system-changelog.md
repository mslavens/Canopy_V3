# System Changelog

The System Changelog provides a historical record of all major updates, bug fixes, and security patches applied to the Canopy workspace.

## Filtering Versions
The local search bar above the changelog document performs a structural filter. Rather than just finding a word, it parses the document and instantly isolates the specific Release Version (`## ` header blocks) containing your search query, hiding all other non-relevant versions to reduce noise.

## Text Highlighting and Navigation
When you enter a search query:
- All matching text substrings are visually highlighted in the document.
- The interface automatically scrolls the first match into view.
- You can cycle through matches using the **Next/Previous** arrows in the search bar, or by pressing `Enter` and `Shift+Enter`.

## Document Source
The changelog is rendered directly from a static markdown file (`changelog.md`) embedded inside the compiled frontend asset bundle. It is automatically updated whenever a `.cpatch` framework update is successfully ingested by the system.