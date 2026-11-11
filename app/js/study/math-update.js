// Patch a named term in the TeX source, then let KaTeX lay out the complete
// equation again (DOM surgery would break fractions and bracket sizing).
export function replaceMathTerm(source, term, replacement) {
  const marker = /\\htmlId\s*\{([^{}]+)\}\s*\{/g;
  for (const match of source.matchAll(marker)) {
    if (match[1].trim() !== term) continue;
    const open = match.index + match[0].length - 1;
    let depth = 1;
    for (let i = open + 1; i < source.length; i++) {
      if (source[i] === "\\") { i++; continue; }
      if (source[i] === "{") depth++;
      if (source[i] === "}" && --depth === 0) return source.slice(0, open + 1) + replacement + source.slice(i);
    }
    return null;
  }
  return null;
}
