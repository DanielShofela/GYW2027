export const OFFICIAL_SITE_URL = 'https://gy2027.netlify.app/';

export function buildWhatsAppShareMessage(shareText: string): string {
  const normalizedText = shareText.trim();
  return `${normalizedText} ${OFFICIAL_SITE_URL}`;
}

export function buildWhatsAppShareUrl(shareText: string): string {
  const message = buildWhatsAppShareMessage(shareText);
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
}
