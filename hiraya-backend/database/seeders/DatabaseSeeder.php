<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // COMMENT OUT O BURAHIN MO ITO (Kasi 'name' ang gamit nito imbes na 'full_name')
        // \App\Models\User::factory(10)->create();

        // ITO LANG DAPAT ANG NAKABUKAS:
        $this->call([
            UserSeeder::class,    // Idagdag mo ito
            SizeChartSeeder::class,
            ProductSeeder::class,
            GarmentSeeder::class,
        ]);
    }
}