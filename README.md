# Atlantic Home

Приватний iPhone-friendly PWA для Atlantic Altis Eco Boost CHG-BD1/Wi-Fi 1000W через Cozytouch.

## Функції
- Авторизація Cozytouch через сервер; пароль Cozytouch не зберігається.
- Керування живленням, цільовою температурою та режимом роботи.
- Перевірка шлюзу й конвектора, автоматичне виявлення відновлення зв'язку після офлайн-стану.
- Оновлення стану приблизно кожні 30 секунд.
- Накопичений лічильник енергії, локальна добова оцінка та хмарна історія показів для графіка за 7/30 днів.
- Орієнтовна вартість за двозонним тарифом і загальним місячним споживанням житла.
- Вбудований розклад конвектора можна вмикати та ставити на паузу через режими PROG/Manual Cozytouch.
- Редагований список пристроїв із синхронізацією через Neon.
- Миттєва потужність у W показується лише якщо пристрій повертає окремий стан потужності з однозначною одиницею виміру.
- Збір енергії у фоні запускається GitHub Actions за розкладом раз на 15 хвилин після додавання `CRON_SECRET` і повторного підключення Cozytouch з refresh token.
- Mycond Roomer Smart 12 може працювати через офіційний Tuya Cloud API, якщо застосунок MYCOND доступний для прив’язки до вашого Cloud-проєкту. Atlantic Home читає фактичні DP стани/команди пристрою й показує лише ті базові типи команд, які повернув API.

## Environment variables

Обов'язково задай у Vercel → Project → Settings → Environment Variables:
- `SESSION_PASSWORD` — випадковий секрет не коротше 32 символів. Використовується для шифрування HttpOnly-сесії.
- `ATLANTIC_APP_PASSWORD` — окремий пароль доступу до вебзастосунку, не коротше 4 символів.
- `DATABASE_URL` — рядок підключення Neon Postgres; потрібен для хмарної історії енергоспоживання, але не для керування конвектором.
- `CRON_SECRET` — окремий випадковий секрет не коротше 32 символів; однакове значення потрібно задати у Vercel та GitHub Actions Secrets.

Для `DATABASE_URL` підключи Neon у Vercel Marketplace до проєкту. Після додавання змінної виконай Redeploy. Таблиці створюються застосунком автоматично.

### MYCOND Roomer Smart 12 через Tuya Cloud (необов'язково)

MYCOND app поширюється через Tuya OEM інфраструктуру, але доступ саме до вашого пристрою залежить від того, чи дозволяє Tuya Developer Platform прив'язати цей OEM app до вашого проєкту. У Tuya Cloud проєкті відкрий **Devices → Link My App → Add Apps** і перевір, чи є там MYCOND. Прив'яжи застосунок із дозволами Read/Write (і Automatic Link, якщо доступно). Якщо MYCOND відсутній у переліку, інтеграцію не можна завершити лише ключами проєкту: потрібне офіційне ввімкнення/доступ від MYCOND.

Для підтримуваного проєкту додай тільки у Vercel Production server-side змінні:
- `TUYA_ACCESS_ID` і `TUYA_ACCESS_SECRET` — Access ID/Secret Cloud-проєкту;
- `TUYA_DEVICE_ID` — ID Roomer Smart 12 у зв'язаному проєкті;
- `TUYA_REGION` — `eu` (за замовчуванням) або `weu`, відповідно до регіону проєкту.

Після redeploy відкрий вкладку «Пристрої». Стани й елементи керування з'являться з фактичної специфікації пристрою. Команди перевіряються сервером на підтримку й на дозволений діапазон/набір значень. Не надсилай Access Secret у чат і не використовуй змінні `NEXT_PUBLIC_` для секретів.

Додай обидві змінні для Production (і Preview, якщо ним користуєшся), потім виконай Redeploy. Не використовуй один і той самий пароль для Cozytouch, SESSION_PASSWORD та ATLANTIC_APP_PASSWORD. Не надсилай ці значення в чат і не додавай їх до Git.

Якщо замінити `SESSION_PASSWORD`, усі раніше видані сесійні cookie перестануть читатися: після redeploy увійди до Atlantic Home знову, а Cozytouch підключи повторно.

## Локальний запуск

```bash
npm install
npm run dev
```

Для локального запуску також потрібні обидві змінні в .env.local.

## Безпека
- Головна сторінка закрита паролем Atlantic Home.
- Доступ до API керування та телеметрії перевіряється серверною сесією.
- Сесія шифрується через iron-session і зберігається в HttpOnly cookie з SameSite=Lax; у Production cookie Secure.
- У налаштуваннях є команда блокування застосунку; Cozytouch-з'єднання при цьому зберігається.
- Запити, що змінюють стан, перевіряють Origin.
- Не зберігати пароль Cozytouch в браузері, localStorage або Git; не комітити токени чи .env файли.

## Troubleshooting

- Якщо замість форми входу з'являється помилка, перевір, що `SESSION_PASSWORD` задано і він має щонайменше 32 символи, а `ATLANTIC_APP_PASSWORD` має щонайменше 4. Після зміни змінних потрібен Redeploy.
- Якщо пароль Atlantic Home приймається, але Cozytouch не підключається, перевір облікові дані Cozytouch та стан сервісу Atlantic. Застосунок не може перевірити пароль облікового запису без входу в сам Cozytouch.
- Якщо вхід працює, але шлюз чи конвектор не відповідає, перевір з'єднання шлюзу з мережею та повторно авторизуй Cozytouch у вкладці «Налаштування».
- Сесія Cozytouch зберігається в браузерній зашифрованій cookie і має обмежений строк дії. Після завершення строку авторизуй Cozytouch повторно.

## API
- POST /api/access/unlock — перевірка пароля Atlantic Home.
- POST /api/access/lock — блокування панелі.
- POST /api/cozytouch/connect — авторизація Cozytouch.
- GET /api/cozytouch/state — телеметрія шлюзу, конвектора та енергоспоживання.
- POST /api/cozytouch/control — керування конвектором.
- POST /api/cozytouch/disconnect — від'єднання Cozytouch без втрати пароля доступу до Atlantic Home.
- GET /api/mycond/status — читання станів та доступних команд MYCOND через Tuya Cloud.
- POST /api/mycond/control — серверна перевірка й надсилання підтримуваної Tuya-команди.

## Обмеження телеметрії
Добова й погодинна статистика отримується для всієї установки Cozytouch, а не гарантовано лише для конвектора. Погодинні дані можуть бути недоступні залежно від відповіді Atlantic API. Миттєві W не розраховуються з припущень: без явного стану потужності з одиницею W/kW інтерфейс покаже «—».

## Energy history

Energy readings are sampled into fifteen-minute buckets by the GitHub Actions workflow and while the app is open. The cumulative counter is the heater sensor reading; daily values are calculated from its deltas. Day/night allocation is estimated between readings, not directly measured by the Atlantic sensor.

## Background collector setup

1. Generate a private random secret of at least 32 characters.
2. Add it as `CRON_SECRET` in Vercel Project → Settings → Environment Variables (Production), then redeploy.
3. Add the same value in GitHub repository → Settings → Secrets and variables → Actions → New repository secret → `CRON_SECRET`.
4. Open Actions → “Collect Atlantic energy history” → Run workflow to check the first collection.
5. Reconnect Cozytouch in Atlantic Home so the app can request offline access and save the encrypted refresh token to Neon. Without a refresh token, collection stops when the short-lived access token expires.

GitHub schedule events may be delayed, and public repositories can have scheduled workflows disabled after 60 days without repository activity. This is near-continuous sampling, not a utility-grade meter.
