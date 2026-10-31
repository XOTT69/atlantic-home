# Atlantic Home

Приватний iPhone-friendly PWA для Atlantic Altis Eco Boost CHG-BD1/Wi-Fi 1000W через Cozytouch.

## Функції
- Авторизація Cozytouch через сервер; пароль Cozytouch не зберігається.
- Керування живленням, цільовою температурою та режимом роботи.
- Перевірка шлюзу й конвектора, автоматичне виявлення відновлення зв'язку після офлайн-стану.
- Оновлення стану приблизно кожні 30 секунд.
- Накопичений лічильник енергії, локальна добова оцінка та хмарна історія показів для графіка за 7/30 днів.
- Орієнтовна вартість за введеним користувачем тарифом.
- Погодинні дані показуються, якщо Atlantic API повертає ці інтервали.
- Миттєва потужність у W показується лише якщо пристрій повертає окремий стан потужності з однозначною одиницею виміру.
- Розклад не активовано: годинник конвектора може скидатися під час знеструмлення.

## Environment variables

Обов'язково задай у Vercel → Project → Settings → Environment Variables:
- `SESSION_PASSWORD` — випадковий секрет не коротше 32 символів. Використовується для шифрування HttpOnly-сесії.
- `ATLANTIC_APP_PASSWORD` — окремий пароль доступу до вебзастосунку, не коротше 4 символів.
- `DATABASE_URL` — рядок підключення Neon Postgres; потрібен для хмарної історії енергоспоживання, але не для керування конвектором.

Для `DATABASE_URL` підключи Neon у Vercel Marketplace до проєкту. Після додавання змінної виконай Redeploy. Таблиця історії створюється застосунком автоматично; покази збираються, коли сторінка Atlantic Home відкрита та отримує телеметрію.

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

## Обмеження телеметрії
Добова й погодинна статистика отримується для всієї установки Cozytouch, а не гарантовано лише для конвектора. Погодинні дані можуть бути недоступні залежно від відповіді Atlantic API. Миттєві W не розраховуються з припущень: без явного стану потужності з одиницею W/kW інтерфейс покаже «—».

## Energy history

Energy readings are sampled at fifteen-minute buckets while the app is receiving Cozytouch telemetry. The cumulative counter is the heater sensor reading; daily values are calculated from its deltas. The chart and cost are estimates. Cost uses the tariff entered in the Energy tab, saved locally in that browser. Without `DATABASE_URL`, only the local estimate is available and readings cannot sync across browsers.
