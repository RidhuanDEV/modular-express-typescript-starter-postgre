# Rencana enhancement fondasi backend

Status: **diimplementasikan pada working tree, belum divalidasi terhadap PostgreSQL/Redis/MinIO hidup atau image Docker**. Basis awal: `main` pada commit `484093d` (22 September 2026). Dokumen ini menyimpan rancangan dan kriteria penerimaan; README dan source saat ini menjadi kontrak implementasi. Konfigurasi dynamic ditetapkan melalui `.env` lalu deploy ulang.

Penyesuaian implementasi: kelas rate limit bawaan tepat `auth`, `public`, dan `internal`; endpoint upload memakai `internal`. Bila diperlukan kelas baru, tambahkan tipe dan env validator lalu ubah registry. Generator OpenAPI sekarang memakai registry + Zod dan output runtime, sedangkan artifact build ada di `dist/docs/openapi.json`.

## 1. Kondisi sumber saat ini

| Area | Sudah ada | Kesenjangan yang perlu ditutup |
| --- | --- | --- |
| Route | Modul `auth`, `user`, `roles`, `permissions` dimuat otomatis dari `*.routes.ts`; `/health` dan `/docs` didaftarkan di `app.ts`. | Metadata endpoint tersebar di route; loader hanya memeriksa `path` dan `Router`, sehingga tidak dapat menjamin seluruh endpoint punya kebijakan audit dan rate limit. |
| Audit | `AuditService` dan `CrudAuditLog` dipakai pada sebagian mutasi; log masuk hanya lewat Pino. | Mode wajib/opsional/tidak perlu belum ada. Snapshot disimpan sebagai string JSON dan beberapa service mengirim objek Prisma mentah, termasuk user dengan hash password. `userId` bertipe wajib pada service walaupun kolom nullable. |
| Waktu | Prisma memakai `DateTime` dan DTO user memakai ISO UTC. | Kolom PostgreSQL pada migration awal adalah `TIMESTAMP(3)` tanpa zona waktu. Belum ada utilitas parse/format zona IANA, aturan offset pada input, dan kebijakan DB/connection UTC. |
| Rate limit | Satu middleware global `100/15 menit` memakai Redis. | Belum ada kelas Auth/Public/Internal, metadata tiap endpoint, dan konfigurasi env. Redis yang tidak tersedia dapat mengganggu seluruh request. |
| Cache | `CacheService` Redis dipakai oleh user/role/permission serta pemeriksaan akun dan RBAC. | `REDIS_URL` wajib; tidak ada sakelar cache. `get<T>` mengandalkan assertion tanpa validasi runtime. Invalidation memakai `KEYS`, dan kegagalan cache dapat menggagalkan request. |
| Upload | Belum ada Multer, adapter S3/MinIO, metadata file, atau endpoint contoh. | Perlu alur local/S3, validasi berkas, rollback/kompensasi, dan volume Docker untuk local storage. |
| Container | `Dockerfile`, `docker-compose.yml`, entrypoint, PostgreSQL 18, Redis 8 sudah tersedia; port host app dan dependency bisa diatur lewat env. | Belum ada compose override contoh, mode tanpa Redis, MinIO opsional, dan volume upload. Entrypoint menjalankan migrasi serta seed pada setiap start; kebijakan itu perlu diputuskan/diamankan. |
| API docs | Ada skrip Zod ke `schemas.json`, Swagger UI, dan spesifikasi per modul. | Operasi HTTP masih ditulis via OpenAPI JSDoc; skrip hanya mengumpulkan schema, tidak menghasilkan endpoint/response/security secara otomatis. Swagger membaca `src/` saat runtime padahal image hanya menyalin `dist/`; kesesuaian docs di image perlu diperbaiki. |

## 2. Kontrak endpoint terpusat

**Pilihan desain:** satu registry TypeScript statis saat build, dinamis saat pengembang menambah/mengubah deklarasi endpoint. Ini menjaga union ID endpoint dan pemeriksaan `satisfies` tetap ketat. Mengubah konfigurasi saat aplikasi berjalan melalui DB/admin UI merupakan fitur lain karena perlu versioning, otorisasi konfigurasi, dan distribusi perubahan antarreplika.

1. Buat `src/core/http/endpoint-registry.ts` berisi `defineEndpoint`/`defineModule` dengan ID unik, method, path absolut dan path Express, `module`, `behavior`, kelas akses, permission, Zod `params/query/body/response`, status sukses, serta kebijakan `audit`, `rateLimit`, dan `cache`. Tetapkan nama endpoint stabil seperti `user.create`; ID tersebut dipakai untuk log, observability, dan generator docs.
2. Kontrak wajib eksplisit: `audit: { mode: "required" | "optional" | "none"; ... }` dan `rateLimit: { group: "auth" | "public" | "internal"; policy?: ... }` untuk **setiap** endpoint, termasuk `/health`, spesifikasi docs, dan `/upload`. Tidak ada default diam-diam untuk audit/rate limit. `cache` eksplisit `off` atau `read` untuk GET yang diizinkan.
3. Registry membangun router Express. Controller tetap adapter HTTP, service tetap mengerjakan operasi bisnis. Hindari mendefinisikan endpoint dua kali (registry dan `router.get/post/...`). Modul ekspor definisi endpoint; loader memuat definisi itu dan gagal saat boot jika ada ID atau method+path ganda, schema yang diwajibkan hilang, atau kebijakan tidak lengkap. Urutkan path statis sebelum `/:id` dan cek ambiguitas route.
4. Gunakan jenis kontrak dari Zod (`z.input` untuk input mentah, `z.output` sesudah parse). Response punya Zod schema dan diserialisasi/validasi di boundary; DTO hasil mapper tidak diambil dari model Prisma. Nilai dinamis dari luar tetap divalidasi saat runtime. Tidak ada `any`, double assertion, atau klaim bahwa tipe kompilasi memvalidasi JSON/cache.
5. Tambahkan pemeriksaan build/CI yang membandingkan route terdaftar dengan output OpenAPI dan menolak endpoint tidak terdaftar. Perbarui `make:crud` untuk menghasilkan definisi registry, schema response, audit/rate/cache policy, dan mapper sesuai pola baru. Perbarui README dan `DEVELOPER-GUIDE.md` setelah kontrak final.

Contoh bentuk API yang diusulkan (pseudocode TypeScript; detail generik ditentukan saat implementasi):

```ts
const createUser = defineEndpoint({
  id: "user.create",
  method: "POST",
  path: "/api/users",
  access: { kind: "internal", permission: "manage_users" },
  schemas: { body: createUserSchema, response: userResponseSchema },
  audit: { mode: "required", behavior: "CREATE", subject: "user" },
  rateLimit: { group: "internal" },
  cache: { mode: "off" },
  handler: userController.create,
});
```

### Saran batas controller dan service

**Disarankan: metadata kebijakan di registry, fakta perubahan di service.** Middleware mengirim context bertipe `{ endpointId, requestId, actorId, occurredAt }`; service mengambil `before` dan `after` dari hasil DB yang benar, memproyeksikan field yang aman, lalu memanggil `auditService.record(createUser, context, change, tx)`. Mode `required` dicatat pada transaksi Prisma yang sama dengan mutasi. Controller cukup memanggil service dan mengirim hasil. Ini menghindari audit dari `req.body`/`res.body` yang bisa berbeda dari data yang benar-benar tersimpan.

Alternatif yang masih aman: wrapper `executeAuditedMutation(endpoint, context, fn)` di service untuk mengurangi boilerplate transaksi. Wrapper menerima callback yang mengembalikan `{ result, audit: { entityId, before, after } }`, dan memaksa hasil audit bila mode `required`. Jangan memakai interceptor controller generik sebagai satu-satunya sumber snapshot karena ia tidak mengetahui perubahan multi-entitas maupun keberhasilan commit.

## 3. Audit dan model data

1. Definisikan semantik: `required` = gagal menyimpan audit berarti mutasi rollback; `optional` = kegagalan audit dicatat ke structured error log/metric tanpa membatalkan mutasi; `none` = tanpa audit aktivitas persisten. Access log Pino tetap terpisah dari audit bisnis. Untuk operasi tanpa mutasi, `required` berarti request yang butuh jejak audit tidak dianggap berhasil jika log gagal; tentukan batas commit yang sesuai per operasi.
2. Catat `actor` (user ID nullable untuk aksi anonim/sistem), `module`, `behavior`, `entityType`, `entityId` nullable bila tidak ada entitas, `before`, `after`, `endpointId`, `requestId`, `occurredAt`. Simpan waktu kejadian sebagai UTC. Bedakan actor yang hilang karena anonim dengan user yang dihapus: simpan snapshot actor aman (misalnya ID dan label yang diizinkan) agar histori tetap terbaca jika relasi `User` menjadi null.
3. Jadikan snapshot `Json?` Prisma / `jsonb` PostgreSQL dan definisikan serializer audit yang allowlist per entitas. Hash password, token, header authorization, secret, dan byte berkas tidak boleh masuk snapshot. Untuk CREATE `before = null`; DELETE `after = null`; UPDATE keduanya berasal dari state DB di dalam transaksi bila perlu konsistensi. Batasi ukuran, nesting, dan field PII yang disimpan.
4. Relasi `User?` tetap optional dengan FK dan `onDelete: SetNull`; tentukan kebijakan retensi terpisah. Audit adalah riwayat append-only: pertimbangkan hapus `updatedAt` dari model audit baru, dan jangan expose operasi update/delete audit. Tambahkan indeks berdasarkan kebutuhan pencarian nyata, minimal `(occurredAt)`, `(module, entityId, occurredAt)`, `(actorId, occurredAt)`, `(endpointId, occurredAt)`; jangan menduplikasi indeks unik yang sudah memberi akses indeks.
5. Buat migration baru, jangan ubah migration `20260524120000_init` yang mungkin sudah terpasang. Migrasikan string `before/after` ke `jsonb` setelah validasi isi lama, dengan strategi penanganan record JSON rusak; tambahkan kolom baru/backfill nilai yang tersedia. Uji `migrate deploy` dari DB lama dan migrasi DB kosong. Audit `register` saat ini mengirim objek user hasil create yang berisi hash password: jadikan pembersihan snapshot sebagai prioritas pertama implementasi.

## 4. Tanggal, waktu, dan zona

1. Semua instan tersimpan sebagai UTC. Migrasi kolom `DateTime` dari `timestamp(3)` ke `timestamptz(3)` dengan interpretasi data lama yang dikonfirmasi (rencana awal: data lama dianggap UTC, lalu `USING column AT TIME ZONE 'UTC'`; **jangan jalankan asumsi ini pada data produksi tanpa memeriksa asal timestamp**). Set timezone sesi PostgreSQL dan container ke UTC untuk konsistensi; jangan menggantungkan penyimpanan pada jam server Jakarta.
2. Utilitas `src/core/time/` menyediakan `nowUtc()`, parse input RFC 3339 **dengan offset/Z wajib** untuk instan, validasi zona IANA, `formatInZone(instant, zone)`, dan parser tanggal kalender lokal jika bisnis membutuhkannya. Gunakan `Intl.DateTimeFormat` untuk `Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`, serta zona luar negeri; jangan hardcode penambahan jam 7/8/9.
3. API mengirim `createdAt/updatedAt/occurredAt` sebagai ISO UTC (`Z`) sebagai kontrak utama. Bila diminta, tambahkan `timezone` IANA yang tervalidasi pada query/profile dan field tampilan ber-offset yang dinamai jelas. Server tidak dapat menyimpulkan zona user hanya dari IP atau lokasi server; client boleh menampilkan ISO UTC sesuai zona device. Query rentang berdasarkan tanggal lokal harus dikonversi menjadi batas UTC sebelum masuk SQL.
4. Uji round-trip UTC↔WIB/WITA/WIT dan zona dengan DST, query lintas batas tanggal, input tanpa offset ditolak, serta DB round-trip setelah migrasi. Pisahkan `DateTime` (instan) dari tanggal saja/`DATE` untuk konsep kalender bisnis.

## 5. Rate limit per endpoint

1. Hapus limiter global tunggal dan pasang limiter saat registry membangun route, sebelum autentikasi dan upload parser. Kelas dasar: `auth` untuk register/login dan operasi kredensial; `public` untuk endpoint anonim lain termasuk health/docs dengan kebijakan wajar; `internal` untuk endpoint yang memerlukan JWT. Definisi endpoint eksplisit memilih kelasnya.
2. Validasi env untuk tiap kelas, misalnya `RATE_LIMIT_AUTH_WINDOW_MS/MAX`, `RATE_LIMIT_PUBLIC_WINDOW_MS/MAX`, `RATE_LIMIT_INTERNAL_WINDOW_MS/MAX`. `policy` endpoint boleh menunjuk nama override yang dideklarasikan dalam konfigurasi typed; env spesifik baru ditambahkan bersama tipe/validator dan komentar contoh `.env.example` (misalnya `RATE_LIMIT_UPLOAD_WINDOW_MS/MAX` jika upload perlu jatah berbeda). Tidak ada nama env arbitrer yang dibuat dari string endpoint tanpa validasi.
3. Kunci limiter `auth/public` memakai identitas jaringan yang aman dari proxy tepercaya; `internal` memakai user ID setelah autentikasi sehingga urutan middleware harus sesuai, dengan pembatas awal berbasis IP untuk mencegah flood token invalid. Konfigurasi `trust proxy` eksplisit; jangan percaya `X-Forwarded-For` langsung. Tentukan kebijakan untuk IPv6 dan endpoint `/health` agar health check tidak terputus.
4. Jika Redis aktif, gunakan store Redis dengan prefix terpisah per policy dan jendela; jika Redis nonaktif, gunakan memory store hanya untuk single instance/development. Pada multi-replica, rate limit bersama membutuhkan Redis/store terdistribusi; konfigurasi production multi-replica harus menolak fallback yang memberi jaminan palsu. Pilih dan dokumentasikan fail-open/fail-closed saat Redis putus untuk setiap kelas; auth disarankan fail-closed atau store cadangan lokal berbatas, tergantung kebutuhan availability.

## 6. Cache opsional

1. Tambahkan `CACHE_ENABLED=false|true` dan `REDIS_URL` wajib hanya jika fitur Redis yang dipilih memerlukannya. Cache per endpoint dinyatakan `off` atau `read` dengan TTL bernilai positif dan kebijakan key. Contoh pertama: `user.getById` atau endpoint baca publik yang aman; jangan cache respons sensitif lintas user tanpa memasukkan actor/permission ke key.
2. `CacheService` menjadi adapter `NoopCache` atau `RedisCache` dengan API typed yang menerima Zod schema saat membaca JSON. Saat cache mati/gagal sementara, baca DB sebagai sumber kebenaran. Tulis cache hanya sesudah commit; invalidasi terkait mutasi dan perubahan permission/akun. Hilangkan `KEYS` pada request path: gunakan key versi/tag atau `SCAN` terbatasi sesuai kebutuhan.
3. `authenticate` dan `requirePermission` harus tetap bekerja dari DB saat cache mati; TTL dan invalidasi tidak boleh membuat user terhapus atau grant berubah memperoleh akses yang salah. Uji Redis disabled, putus saat request, dan perubahan role/permission. Queue BullMQ tetap fitur terpisah yang membutuhkan Redis ketika dipakai; env/boot queue harus lazy dan tidak memaksa Redis untuk API biasa.

## 7. Upload lokal atau MinIO/S3

1. Usulkan `UPLOAD_ENABLED=true|false`, `UPLOAD_STORAGE=local|s3`, `UPLOAD_LOCAL_DIR`, `UPLOAD_MAX_BYTES`, `UPLOAD_ALLOWED_MIME`; hanya saat `s3` dipilih wajibkan `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` (MinIO), serta pengaturan TLS yang tervalidasi. Default contoh `local`; mode `UPLOAD_ENABLED=false` menonaktifkan route upload secara eksplisit melalui registry/feature flag.
2. Buat `StorageService` dengan adapter local dan S3-compatible, `Multer` hanya sebagai parser multipart dengan batas ukuran/jumlah dan error terstruktur. Gunakan nama objek acak, path yang dinormalisasi, allowlist MIME disertai pemeriksaan signature file untuk tipe penting, dan jangan mempercayai nama asli sebagai path. Local directory berada di luar source tree dan memakai volume persisten pada Docker.
3. Endpoint template `POST /api/upload/` sebagai `internal` berizin jelas, audit `required`, rate limit `internal` (atau override upload bila diaktifkan), cache `off`. Return metadata typed (`id`, storage key, original name yang aman, MIME, bytes, createdAt UTC). Tambahkan `GET /api/upload/:id` metadata sebagai contoh cache `read` jika endpoint itu dinilai tidak sensitif; unduhan berkas harus lewat route terotorisasi atau signed URL berumur pendek.
4. Model `StoredFile` memuat ID, storage backend, object key unik, owner `User?`/uploader, MIME, ukuran, status, waktu; migration menambah FK dan indeks. DB transaction tidak dapat mencakup filesystem/S3: unggah ke key sementara, simpan metadata/audit, finalisasi atau kompensasi hapus objek saat gagal; siapkan cleanup untuk objek yatim. Jangan mengklaim atomicity lintas DB dan object store.

## 8. Docker dan Compose opsional

1. Pertahankan `npm run dev/start` manual. Rapikan `Dockerfile` multi-stage yang ada, `.dockerignore`, healthcheck, user non-root, dan lokasi build artifact OpenAPI. Compose utama menjalankan app + PostgreSQL; Redis dan MinIO lewat profile/compose tambahan bila fitur diaktifkan. Compose override contoh menjelaskan `APP_PORT` dan port Postgres/Redis/MinIO; jangan meng-hardcode port aplikasi berbeda dari `PORT` di container.
2. Mount volume bernama untuk PostgreSQL, Redis bila aktif, MinIO bila aktif, dan upload lokal. Jangan meletakkan credential nyata di repo. Cek keselarasan `DATABASE_URL`/`REDIS_URL` dengan nama service Docker dan `.env` manual. Tetapkan migrasi sebagai langkah startup/deploy yang jelas; seed demo tidak seharusnya dijalankan otomatis di setiap restart production kecuali terbukti idempotent dan diinginkan.
3. Uji tiga jalur: manual tanpa Redis, Compose minimal tanpa Redis, Compose dengan Redis+MinIO. Uji ganti port host via override/env dan persistensi berkas setelah restart. Nyatakan bahwa profile MinIO diperlukan hanya bila `UPLOAD_STORAGE=s3` menunjuk MinIO lokal; S3 eksternal tidak butuh container MinIO.

## 9. OpenAPI otomatis tanpa JSDoc

1. Hasilkan OpenAPI 3.1 dari registry endpoint dan Zod request/response schema. Metadata `summary`, `description`, tag, security, contoh, error dan status ditulis sebagai objek TypeScript pada definisi endpoint. Parameter path/query/body, MIME upload, bearer auth, dan response envelope diambil dari kontrak yang sama dengan runtime. Hindari pemindaian JSDoc dan file `schemas.json` manual sebagai sumber utama.
2. Build menghasilkan artifact JSON di `dist/docs/openapi.json`; aplikasi hanya menyajikannya di `/docs/openapi.json` dan Swagger UI `/docs`. Untuk dropdown per modul, filter spec yang sama berdasarkan tag/module dan pertahankan `$ref` yang diperlukan. Ini memperbaiki ketergantungan pada folder `src` di image runtime.
3. Tambahkan `npm run api-docs` untuk generate, `api-docs:check` untuk mendeteksi artifact stale/invalid, serta validasi OpenAPI pada CI. Setiap endpoint registry harus muncul tepat sekali; setiap request/response schema harus dapat di-resolve; contoh `curl`/Postman yang masih dipelihara harus disesuaikan. Hapus `swagger-jsdoc` setelah jalur baru lulus verifikasi.

## 10. Tahap implementasi dan kriteria selesai

| Tahap | Perubahan utama | Bukti penerimaan |
| --- | --- | --- |
| 0 — Keamanan dasar | Redaksi snapshot audit saat ini; inventaris semua route dan data historis. | Tidak ada hash/token pada audit baru; daftar endpoint aktual lengkap. |
| 1 — Registry dan docs | Migrasi seluruh route termasuk health/docs ke definisi typed; generator CRUD dan OpenAPI diperbarui. | Build strict lulus; jumlah method+path runtime = registry = OpenAPI; tidak ada `@openapi` JSDoc. |
| 2 — Audit dan waktu | Mode audit, transaksi, model/migration JSONB, UTC/timestamptz, utilitas zona. | Uji rollback required, optional tetap sukses saat log gagal, none tanpa row; round-trip DB/WIB/WITA/WIT/DST; migrasi lama dan fresh lulus. |
| 3 — Rate limit dan cache | Env per kelas/override, store optional, cache no-op dan validasi payload, invalidasi. | Setiap endpoint punya kelas; 429 dan reset sesuai env; API, auth, RBAC berfungsi tanpa Redis; mode multi-replica tidak diam-diam memakai memory store. |
| 4 — Upload dan container | Multer, storage local/S3, metadata/migration, route contoh, compose profile/override. | Upload valid berhasil di local dan MinIO, file ditolak sesuai policy, metadata konsisten, restart mempertahankan file; manual serta Compose minimal berhasil. |
| 5 — Dokumentasi akhir | README, guide, `.env.example`, generator dan contoh request diperbarui. | Pengembang dapat menambah endpoint baru dengan audit/rate/cache/docs dalam satu definisi typed dan menjalankan `api-docs:check`. |

Pemeriksaan pada tiap tahap: `npm run build`, migration deploy terhadap DB kosong dan DB lama contoh, pengujian integrasi HTTP/Prisma/Redis/storage yang relevan, serta inspeksi output OpenAPI. Jangan menyamakan typecheck dengan bukti runtime container atau keberhasilan migrasi produksi.

## Keputusan produk yang perlu dikunci sebelum implementasi

1. **Konfigurasi dinamis:** rekomendasi saya adalah registry TypeScript yang diubah lewat code/redeploy. Jika yang dimaksud adalah admin dapat mengganti mode audit/rate limit saat runtime, perlu desain tabel policy, izin admin, versioning, audit atas perubahan policy, dan sinkronisasi antarreplika.
2. **Perilaku audit `optional`:** rekomendasi saya tetap membuat row DB secara best effort, lalu log kesalahan bila gagal. Alternatifnya hanya Pino tanpa row DB; ini mengubah makna histori aktivitas.
3. **Upload default:** rekomendasi endpoint contoh aktif dengan local storage pada development, disabled sampai storage/izin disetel di production. Tentukan juga jenis file yang diperbolehkan dan apakah download publik atau privat.
4. **Data waktu lama:** perlu konfirmasi apakah timestamp database lama disimpan sebagai UTC, WIB, atau campuran sebelum menjalankan konversi `timestamptz` pada data nyata.
5. **Availability rate limit:** saat Redis gagal pada production multi-replica, pilih apakah auth fail-closed atau menerima fallback lokal yang tidak memberi batas global. Rekomendasi awal: fail-closed untuk auth, kebijakan eksplisit untuk public/internal.
