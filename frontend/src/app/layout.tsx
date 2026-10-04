import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Uplico · Ofis Asistanı',
  description: 'Şirket bilgileri bir arada. Soruların cevapları, kaynaklarıyla yanında.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
