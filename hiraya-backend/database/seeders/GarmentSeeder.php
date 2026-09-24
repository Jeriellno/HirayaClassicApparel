<?php

namespace Database\Seeders;

use App\Models\Garment;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Schema;

class GarmentSeeder extends Seeder
{
    public function run(): void
    {
        // Disable foreign key checks to avoid issues
        Schema::disableForeignKeyConstraints();

        // Clear existing garments
        Garment::truncate();

        // Enable foreign key checks
        Schema::enableForeignKeyConstraints();

        // Sample transparent PNG data URIs (1x1 transparent pixels as minimal Base64)
        // These are valid minimal transparent PNGs encoded as Data URIs
        $transparentPng1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

        // Sample garment: Classic White Tee (Top - layer_order: 10)
        Garment::create([
            'name' => 'Classic White Tee',
            'category' => 'top',
            'image_base64' => $transparentPng1x1,
            'layer_order' => 10,
            'price' => 29.99,
        ]);

        // Sample garment: Slim Fit Jeans (Bottom - layer_order: 5)
        Garment::create([
            'name' => 'Slim Fit Jeans',
            'category' => 'bottom',
            'image_base64' => $transparentPng1x1,
            'layer_order' => 5,
            'price' => 79.99,
        ]);

        // Sample garment: Evening Cocktail Dress (Dress - layer_order: 15)
        Garment::create([
            'name' => 'Evening Cocktail Dress',
            'category' => 'dress',
            'image_base64' => $transparentPng1x1,
            'layer_order' => 15,
            'price' => 189.99,
        ]);

        // Sample garment: Wool Blend Blazer (Outerwear - layer_order: 20)
        Garment::create([
            'name' => 'Wool Blend Blazer',
            'category' => 'outerwear',
            'image_base64' => $transparentPng1x1,
            'layer_order' => 20,
            'price' => 249.99,
        ]);
    }
}