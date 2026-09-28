# Telegram AI Assistant — MVP

Минимальный прототип AI-автоответчика для личных сообщений Telegram.

Поток:

Telegram → Telethon → OpenAI → ответ в Telegram

## 1. Установка

Рекомендуется Python 3.11+.

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Установка зависимостей:

```bash
python -m pip install -r requirements.txt
```

## 2. Настройки

Скопируйте `.env.example` в `.env`:

```powershell
Copy-Item .env.example .env
```

Заполните:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `OPENAI_API_KEY`

Не публикуйте `.env` и `assistant_session.session` в GitHub.

## 3. Первый запуск

```bash
python main.py
```

При первом запуске Telethon попросит номер телефона и код Telegram. После успешной авторизации создаст локальный session-файл.

## 4. Проверка

С другого Telegram-аккаунта напишите тестовому аккаунту личное сообщение.

Первая версия отвечает только на текстовые личные сообщения. Группы, каналы и голосовые пока игнорируются.

## Важно

Это экспериментальный MVP. Не подключайте основной Telegram-аккаунт до проверки поведения системы на тестовом аккаунте.
