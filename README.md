# MAHDY-NET Billing V8.0 Event Ledger

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


## V7.1 hotfix
- Mencegah file payment tahunan ganda saat sinkron cepat/berulang.
- Menyimpan ID file Drive aktif di cache browser.
- Membersihkan duplikat bernama sama di folder aktif saat sinkron berikutnya (duplikat dipindahkan ke Trash).
- Menambahkan lock agar dua proses kirim Drive tidak berjalan bersamaan.


## V7.2 WhatsApp pelanggan
- Field WhatsApp resmi pada tambah/edit pelanggan.
- Input 08..., 8..., atau 62... dinormalisasi menjadi 62....
- WhatsApp disimpan di customers.json dan ikut ke bot/wa-status.json.
- customerId/customerCode tetap menjadi identitas permanen.
- Pelanggan lama tanpa nomor tetap aman.

## V7.2.1 hotfix edit pelanggan
- Memisahkan ID pelanggan yang sedang dilihat dari ID pelanggan yang sedang diedit.
- Mencegah nomor/nama dari edit pelanggan A bocor ke pelanggan B.
- Setelah Simpan/Batal, target edit selalu di-reset.
- Update hanya dilakukan pada satu record customer ID yang dipilih.


# V8.0 Event Ledger

V8 mengubah sinkronisasi dari overwrite database menjadi merge per-event. Data V7 dimigrasikan tanpa menghapus store lama terlebih dahulu. Pembayaran, pembatalan, edit pelanggan, dan edit paket dicatat sebagai event append-only.

## Pengaman utama
- HP kosong tidak dapat menghapus Drive karena sinkron tidak melakukan replace database.
- Event HP, Drive, dan bot digabung berdasarkan eventId.
- Konflik eventId dengan isi berbeda menghentikan sinkron.
- Konflik dua customer berbeda memakai customerCode yang sama menghentikan sinkron.
- PAID -> CANCELLED -> PAID tetap menyimpan seluruh sejarah dan status akhir dihitung dari event terbaru.
- Tombol Batalkan Pembayaran membuat event baru; record sejarah tidak dihapus.
- `bot-events.json` dibuat oleh Billing dan hanya file itu yang diberi izin Writer ke service account bot.
- Template/bot tidak terkait dengan paket Billing ini dan tidak diubah.


## Audit final V8.0
- Sinkron per-event; HP kosong tidak mempunyai jalur overwrite database.
- Event migration V7 dari HP dan Drive dideduplikasi berdasarkan isi event, bukan label sumber.
- Jika satu file event Drive gagal dibaca, sinkron berhenti sebelum menulis.
- Jumlah event billing di manifest divalidasi terhadap event unik yang benar-benar terbaca.
- Setelah event HP ditulis, sinkron melakukan final re-read untuk menangkap event dari HP lain yang masuk saat proses berjalan.
- `bot-events.json` wajib dapat dibaca dan service account wajib memiliki Writer; jika tidak, sinkron dihentikan agar integrasi tidak setengah aktif.
- Backup snapshot dibuat sebelum merge terhadap Drive yang sudah berisi data.
