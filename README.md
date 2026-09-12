# MAHDY-NET Billing V8.3 — Ultra Fast No-Change Sync

V8.2 adalah patch tampilan dan pengalaman penggunaan di atas mesin Event Ledger V8.1. Schema data tetap **8**, sehingga data pelanggan, paket, pembayaran, cache, `wa-status.json`, dan `bot-events.json` lama tetap kompatibel.

## Perubahan V8.2

- Sesi Google disimpan di perangkat dan dipulihkan otomatis selama token masih berlaku.
- Saat sesi Google perlu diperbarui, aplikasi mencoba menyambungkan kembali akun yang sama tanpa memaksa memilih akun berulang kali.
- Tombol **Ganti akun Google** dipisahkan dari tombol **Putuskan**.
- Nama akun aktif ditampilkan pada kartu Google Drive.
- Tampilan mobile daftar pelanggan/transaksi, tombol, pager, dan kartu dibuat lebih rapi.
- Modal memakai animasi buka yang lebih lembut; tombol sinkron menampilkan status proses.
- Manifest Drive memakai cache metadata agar tahap perbandingan dan sinkron berulang lebih cepat.

## Tambalan V8.2.1

- Halaman Pelanggan mobile dirombak mengikuti desain acuan: header ringkas, status Drive, total pelanggan, pencarian, filter, urutan, pemilih satu bulan, dan daftar pelanggan berbentuk kartu.
- Tabel 12 bulan tetap tersedia untuk desktop, tetapi tidak lagi dipaksakan tampil pada HP.
- Navigasi bawah tidak lagi menutupi daftar pelanggan.
- Pergantian akun Google kini transaksional: akun lama baru diganti setelah akun baru berhasil dipilih. Membatalkan pemilih akun tidak memutus koneksi lama.

## Tambalan V8.2.2

- Menambahkan penanda versi pada pemanggilan `styles.css` dan `app.js` agar Chrome/GitHub Pages tidak memakai visual lama dari cache.
- Menambahkan aturan no-cache pada halaman utama.
- Setelah diekstrak, unggah **isi paket** (`index.html`, `app.js`, `styles.css`, folder `assets`) untuk menggantikan file lama di root repository. Jangan mengunggah ZIP saja karena GitHub Pages tidak mengekstraknya.

## Optimasi V8.3

- Fast No-Change Mode membandingkan hash event lokal, hash manifest, gabungan event Drive, metadata file, dan cache bot.
- Jika seluruh sumber sama dan sinkron penuh sudah dilakukan pada hari yang sama, proses selesai tanpa materialisasi, backup delta, atau penulisan file turunan.
- Bila tanggal berubah atau ditemukan perbedaan sekecil apa pun, sinkron penuh tetap berjalan agar status jatuh tempo dan data bot diperbarui dengan aman.
- Laporan hasil membedakan `no-change` dan `full`, sekaligus tetap menampilkan waktu proses.

## Mesin data V8.1 yang tetap dipertahankan

Versi ini adalah upgrade langsung dari Billing V8.0 Event Ledger. **Schema Event Ledger tetap 8** sehingga data V8.0 tidak perlu dihapus atau dimigrasi ulang.

## Perubahan utama

### 1. Data WhatsApp Bot siap untuk 1 atau banyak invoice
`bot/wa-status.json` naik ke schema 3 tetapi tetap menyimpan field kompatibilitas lama (`invoiceId`, `billingPeriod`, `amount`, `status`, dst.).

Setiap pelanggan sekarang juga membawa:
- `outstandingInvoices[]`
- `outstandingCount`
- `outstandingTotal`
- `outstandingInvoiceIds[]`
- `latestOutstandingInvoice`
- `latestIssuedInvoice`
- `pascaBayarExample`
- `dynamicMessage.unpaid`

`pascaBayarExample` selalu diambil dari **invoice terbaru yang sudah terbit**, sehingga Bot nanti dapat membuat kalimat seperti:

> Tagihan yang terbit pada 20 September 2026 merupakan pembayaran atas pemakaian Agustus 2026. Pemakaian September 2026 akan ditagihkan pada 20 Oktober 2026.

Invoice lama tetap masuk rincian tunggakan tetapi tidak perlu dijadikan contoh pascabayar satu per satu.

### 2. Dua template dinamis untuk Bot berikutnya
Billing mempublikasikan capability untuk dua template adaptif:
- `dynamic_bill_unpaid`
- `dynamic_bill_paid`

Satu template yang sama dapat menangani 1, 2, 3, 4, 5, dst. invoice. Jumlah invoice, rincian, dan total dihitung dari data, bukan dari pilihan template per jumlah bulan.

### 3. Pembayaran beberapa invoice sekaligus
Pada Detail Pelanggan tersedia tombol **Lunasi beberapa tagihan**.

Semua invoice yang dipilih mendapat satu `paymentGroupId`. Event tetap satu per invoice agar state akhir invoice tetap independen, tetapi group metadata membuat Bot berikutnya dapat mengirim **satu pesan LUNAS** untuk seluruh invoice dalam transaksi tersebut.

Untuk mencegah Bot V2 lama mengirim notifikasi berkali-kali, hanya event invoice terbaru dalam grup yang diberi `notifyCustomer:true`. Bot dinamis berikutnya akan membaca `paymentGroupId` dan seluruh rincian grup.

### 4. Nominal invoice lama lebih stabil
Untuk invoice belum lunas, V8.1 mencoba menentukan nominal berdasarkan histori event pelanggan pada tanggal tagihan tersebut. Pembayaran yang sudah tercatat tetap memakai nominal historis pada event pembayaran.

### 5. Fast Event Sync
Sinkron normal tidak lagi selalu mengunduh semua file event dan menulis semua file turunan.

Optimasi:
- ID struktur folder Drive disimpan di cache perangkat.
- Metadata file event diperiksa lebih dulu.
- File event yang tidak berubah memakai cache IndexedDB lokal.
- File event yang berubah diunduh secara paralel.
- Final safety pass tetap ada, tetapi hanya perubahan baru yang diambil.
- Log event perangkat hanya ditulis jika isi event perangkat memang berubah.
- Sebelum log perangkat ditimpa, dibuat backup delta di folder `backups`.
- File turunan (`packages.json`, `customers.json`, `current.json`, `summary.json`, `wa-status.json`, pembayaran per tahun) hanya ditulis jika hash kontennya berubah.
- `manifest.json` menyimpan `eventHash` dan `fileHashes`.
- Backup manual tetap membuat snapshot penuh seperti sebelumnya.

Sync pertama setelah upgrade mungkin tetap lebih lama karena cache/file hash belum tersedia. Sync berikutnya yang hanya memiliki sedikit perubahan seharusnya jauh lebih cepat.

## Pengaman yang tetap dipertahankan
- Event append-only sebagai source of truth.
- HP kosong tidak punya jalur overwrite seluruh Drive.
- Konflik event ID dengan isi berbeda diblokir.
- Konflik customerCode diblokir.
- File event Drive yang gagal dibaca membatalkan sync sebelum materialisasi akhir.
- Manifest yang mengaku punya lebih banyak event daripada yang terbaca membatalkan sync.
- `bot-events.json` tetap satu-satunya channel event billing yang dapat ditulis Bot.
- Writer service account tetap diverifikasi, lalu hasil verifikasi dicache maksimal 24 jam.
- Pembatalan pembayaran membuat event baru; event LUNAS lama tidak dihapus.

## Urutan upgrade
1. Export JSON dari Billing V8.0 sebagai cadangan lokal.
2. Jangan hapus IndexedDB/browser data.
3. Ganti file GitHub Pages dengan isi folder V8.1 ini.
4. Buka V8.1 pada HP utama yang datanya paling lengkap.
5. Hubungkan Drive.
6. Jalankan **Bandingkan & Sinkron → GABUNGKAN EVENT SEKARANG**.
7. Setelah V8.1 sukses satu kali, HP lain dapat reload V8.1 dan sync satu per satu.

## Catatan Bot
Billing V8.1 sengaja dibuat lebih dulu. Bot V2.0.x lama tetap membaca field kompatibilitas lama. Fitur pesan multiple/dinamis penuh akan digunakan setelah Bot versi berikutnya diperbarui untuk membaca `outstandingInvoices`, `pascaBayarExample`, `paymentGroupId`, dan `paymentGroups`.
