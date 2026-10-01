FROM php:8.2-cli

RUN apt-get update && apt-get install -y \
    unzip \
    libpq-dev \
    libcurl4-openssl-dev \
    && docker-php-ext-install pdo pdo_pgsql pdo_mysql

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html
COPY . .

RUN composer install --no-dev --optimize-autoloader

# `php artisan serve` is single-threaded unless this is set; on Linux the
# built-in server forks this many workers so parallel API calls don't queue.
ENV PHP_CLI_SERVER_WORKERS=4

EXPOSE 10000

# QUEUE_CONNECTION=database needs a worker draining the `tryon` queue, or every
# try-on session stays `queued`. Run it in the background next to the server,
# restarting it if it ever exits. Tries/timeout come from ProcessTryOnJob itself.
CMD php artisan config:clear \
    && (while true; do php artisan queue:work --queue=tryon,default; sleep 3; done &) \
    && php artisan serve --host 0.0.0.0 --port 10000
