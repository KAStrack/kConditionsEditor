<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Tests\Fixtures;

/** Target for the manifest-callback resolution tests. */
final class Probe
{
    /**
     * @param array<int, mixed> $args
     * @param array<string, mixed> $ctx
     */
    public static function yes(mixed $value, array $args, array $ctx): bool
    {
        return true;
    }
}
