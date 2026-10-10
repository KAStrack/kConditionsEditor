<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor;

/**
 * The skip sentinel.
 *
 * A node that resolves to Skip behaves as though it were never in the document:
 * it is dropped from its parent's children. A group whose children all resolve
 * to Skip is itself Skip, propagating upward. A document that resolves entirely
 * to Skip yields the evaluator's `emptyResult` option.
 *
 * A registered callback may return Skip::instance() to opt out at runtime.
 */
final class Skip
{
    private static ?self $instance = null;

    private function __construct()
    {
    }

    public static function instance(): self
    {
        return self::$instance ??= new self();
    }

    public static function is(mixed $value): bool
    {
        return $value instanceof self;
    }
}
