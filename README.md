# MAHDY-NET Billing V7

Versi V7 dibangun dari V6 Premium UI dengan fokus pada skalabilitas dan integrasi WhatsApp Bot.

## Perubahan utama
- Customer ID permanen otomatis: `C000001`, `C000002`, dst.
- Migrasi otomatis pelanggan V6 yang belum memiliki Customer ID.
- IndexedDB V2 dengan index pembayaran per pelanggan/periode sehingga tabel tidak lagi memindai seluruh riwayat berulang kali.
- Cache `current` dan `summary` untuk dashboard agar pembukaan web di HP tetap ringan.
- Riwayat transaksi pada menu pembayaran dibatasi per tahun dan maksimal 250 item render sekaligus.
- Google Drive V7 memakai satu folder utama `MAHDY-NET Billing` dengan struktur:
  - `data/manifest.json`
  - `data/customers.json`
  - `data/packages.json`
  - `data/current.json`
  - `data/summary.json`
  - `payments/YYYY.json`
  - `bot/wa-status.json`
  - `backups/YYYY/SNAPSHOT_.../`
- Sinkron V7 tetap manual/terarah; data HP kosong diblokir agar tidak menimpa cloud berisi data.
- Data V6 `mahdy-net-data.json` masih dapat dibaca saat migrasi dan tidak dihapus otomatis.
- Snapshot backup Drive dibuat sebelum overwrite struktur V7.
- `wa-status.json` berisi data ringkas yang nanti dibaca STB/WhatsApp Bot secara read-only.

## Catatan migrasi
Sebelum migrasi pertama, tetap simpan satu export JSON V6 di HP. Pada pengiriman pertama ke Drive V7, file V6 lama tidak dihapus dan akan disalin ke snapshot migrasi jika ditemukan.
