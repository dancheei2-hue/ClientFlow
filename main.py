import os
from collections import defaultdict, deque

from dotenv import load_dotenv
from openai import OpenAI
from telethon import TelegramClient, events

load_dotenv()

API_ID = int(os.environ["TELEGRAM_API_ID"])
API_HASH = os.environ["TELEGRAM_API_HASH"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
INSTRUCTIONS = os.getenv(
    "ASSISTANT_INSTRUCTIONS",
    "Ты вежливый помощник. Отвечай естественно, коротко и по делу. Не выдумывай факты.",
)

ai = OpenAI(api_key=OPENAI_API_KEY)
telegram = TelegramClient("assistant_session", API_ID, API_HASH)

# Temporary in-memory conversation history.
# It will be replaced by a database in the next version.
history = defaultdict(lambda: deque(maxlen=20))


def generate_reply(chat_id: int, user_text: str) -> str:
    messages = list(history[chat_id])
    messages.append({"role": "user", "content": user_text})

    response = ai.responses.create(
        model=MODEL,
        instructions=INSTRUCTIONS,
        input=messages,
    )

    answer = response.output_text.strip()
    if not answer:
        answer = "Не смог сформировать ответ. Передам сообщение владельцу."

    history[chat_id].append({"role": "user", "content": user_text})
    history[chat_id].append({"role": "assistant", "content": answer})
    return answer


@telegram.on(events.NewMessage(incoming=True))
async def handle_message(event):
    # Ignore groups/channels for the first prototype.
    if not event.is_private:
        return

    # Ignore messages without text for now. Voice support comes later.
    text = event.raw_text.strip()
    if not text:
        return

    sender = await event.get_sender()
    sender_name = getattr(sender, "first_name", "клиент") or "клиент"
    print(f"[{sender_name}] {text}")

    try:
        answer = generate_reply(event.chat_id, text)
        await event.respond(answer)
        print(f"[AI] {answer}\n")
    except Exception as exc:
        print(f"AI error: {exc}")
        await event.respond("Я получил сообщение. Немного позже отвечу подробнее.")


async def main():
    me = await telegram.get_me()
    print(f"Авторизован как: {me.first_name} (@{me.username or 'без username'})")
    print("AI-автоответчик запущен. Для остановки нажмите Ctrl+C.")
    await telegram.run_until_disconnected()


if __name__ == "__main__":
    with telegram:
        telegram.loop.run_until_complete(main())
