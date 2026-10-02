/* The device word, and the two forms the copy needs of it (passwordless-access
   D12). Each app names the thing in the person's hand — "este dispositivo" in
   the panel, "este teléfono" in the store app, "esta computadora" where it
   knows — and passes it as one prop. The lines then need:

   - the noun alone, after a possessive: "se quedan en tu teléfono",
     "Esperando a tu dispositivo." — "tu este teléfono" is not Spanish;
   - the word opening a sentence: "Este dispositivo ya tiene tu huella o
     rostro."

   Derived here once so the two atoms that speak of the device cannot drift
   into two spellings of the same sentence (constitution VI). */

/* "este dispositivo" → "dispositivo". A word with no determiner is already a
   noun, and is returned whole rather than as an empty string. */
export function deviceNoun(deviceWord: string): string {
  const [, ...rest] = deviceWord.trim().split(/\s+/);
  return rest.length > 0 ? rest.join(" ") : deviceWord.trim();
}

/* "este dispositivo" → "Este dispositivo" */
export function sentenceStart(deviceWord: string): string {
  const word = deviceWord.trim();
  return word.charAt(0).toUpperCase() + word.slice(1);
}
