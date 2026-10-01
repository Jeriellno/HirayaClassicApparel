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

EXPOSE 10000

CMD php artisan serve --host 0.0.0.0 --port 10000