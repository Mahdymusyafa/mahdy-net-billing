MAHDY-NET WEB BILLING V8.1 - PATCH PEMBAYARAN LEBIH AWAL

Paket ini khusus Web Billing. Tidak berisi file WA Bot.

Cara memasang:
1. Buka repository GitHub Pages MAHDY-NET Billing.
2. Ganti app.js lama di root repository dengan app.js dari paket ini.
3. Commit perubahan dan tunggu GitHub Pages selesai memperbarui situs.
4. Buka Web Billing, lakukan hard refresh, lalu sinkronkan Google Drive.

Hasil:
- Invoice periode berjalan dapat dilunasi sebelum tanggal jatuh tempo.
- Bulan yang belum menjadi periode berjalan tetap terkunci.
- Pembayaran lebih awal tidak dihitung sebagai tunggakan.
- Data dan Event Ledger lama tetap dipertahankan.
