<?php

declare(strict_types=1);

/**
 * Standalone autoloader for projects that are not using Composer.
 *
 *   require __DIR__ . '/vendor/kConditionsEditor/sdk/php/autoload.php';
 *   $ok = Kastrack\ConditionsEditor\evaluate($document, $data);
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'Kastrack\\ConditionsEditor\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $file = __DIR__ . '/src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

require_once __DIR__ . '/src/functions.php';
