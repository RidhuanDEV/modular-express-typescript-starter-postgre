#!/bin/sh
set -eu

attempt=1
until npx prisma migrate deploy; do
  if [ "$attempt" -ge 30 ]; then
    echo "Prisma migrate deploy failed after $attempt attempts" >&2
    exit 1
  fi

  echo "Database is not ready; retrying migration in 2s ($attempt/30)"
  attempt=$((attempt + 1))
  sleep 2
done

npm run seed:prod

exec "$@"
