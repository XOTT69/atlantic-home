# Atlantic Home

Приватний iPhone-friendly PWA для Atlantic Altis Eco Boost CHG-BD1/Wi-Fi 1000W через Cozytouch.

## Функції
- Авторизація Cozytouch через сервер; пароль Cozytouch не зберігається.
- Керування живленням, цільовою температурою та режимом роботи.
- Перевірка шлюзу й конвектора, автоматичне виявлення відновлення зв'язку після офлайн-стану.
- Оновлення стану приблизно кожні 30 секунд.
- Добове та погодинне споживання, якщо Atlantic API повертає ці інтервали.
- Розрахунок вартості добового споживання за тарифом, який задає користувач (зберігається локально в браузері).
- Орієнтовна середня потужність за останній погодинний інтервал на основі кВт·год; це не миттєве вимірювання.
- Миттєва потужність у W показується лише якщо пристрій повертає окремий стан потужності з однозначною одиницею виміру.
- Розклад не активовано: годинник конвектора може скидатися під час знеструмлення.

## Environment variables

Обов'язково задай у Vercel → Project → Settings → Environment Variables:
- `SESSION_PASSWORD` — випадковий секрет не коротше 32 символів. Використовується для шифрування HttpOnly-сесії.
- `ATLANTIC_APP_PASSWORD` — окремий пароль доступу до вебзастосунку, не коротше 4 символів.

Додай обидві змінні для Production (і Preview, якщо ним користуєшся), потім виконай Redeploy. Не використовуй один і той самий пароль для Cozytouch, SESSION_PASSWORD та ATLANTIC_APP_PASSWORD. Не надсилай ці значення в чат і не додавай їх до Git.

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

## API
- POST /api/access/unlock — перевірка пароля Atlantic Home.
- POST /api/access/lock — блокування панелі.
- POST /api/cozytouch/connect — авторизація Cozytouch.
- GET /api/cozytouch/state — телеметрія шлюзу, конвектора та енергоспоживання.
- POST /api/cozytouch/control — керування конвектором.
- POST /api/cozytouch/disconnect — від'єднання Cozytouch без втрати пароля доступу до Atlantic Home.

## Обмеження телеметрії
Добова й погодинна статистика отримується для всієї установки Cozytouch, а не гарантовано лише для конвектора. Погодинні дані можуть бути недоступні залежно від відповіді Atlantic API. Миттєві W не розраховуються з припущень: без явного стану потужності з одиницею W/kW інтерфейс покаже «—».

## Electricity tariff estimate

The Energy tab uses Cozytouch daily peak/off-peak consumption when both tariff-zone values are available. It estimates cost with the Ukrainian two-zone schedule: day 07:00–23:00 and night 23:00–07:00. From October through April, the default winter benefit estimate is UAH 2.64/kWh day and UAH 1.32/kWh night up to 2,000 kWh/month; the alternate “Понад ліміт” option uses UAH 4.32/kWh day and UAH 2.16/kWh night. From May through September, standard rates apply. The winter tier choice is stored in the current browser.

The 2,000 kWh threshold is a household monthly threshold, while Cozytouch data can cover only the connected setup. The user must switch to “Понад ліміт” once total household monthly consumption exceeds the threshold. Cost is an estimate, not a utility-bill statement; if Cozytouch does not provide separate day/night values, cost remains unavailable rather than being guessed.
