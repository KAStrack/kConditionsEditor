<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor;

/**
 * The detailed outcome of evaluating a condition document.
 *
 * Implements ArrayAccess so it can be consumed like the plain array the other
 * SDKs return: $details['skipped'] and $details->skipped both work.
 *
 * @implements \ArrayAccess<string, mixed>
 */
final class EvaluationResult implements \ArrayAccess, \JsonSerializable
{
    /**
     * @param array<int, array<string, mixed>> $skipped
     * @param array<int, array<string, mixed>> $errors
     * @param array<int, array<string, mixed>>|null $trace
     */
    public function __construct(
        public readonly bool $result,
        public readonly array $skipped = [],
        public readonly array $errors = [],
        public readonly ?array $trace = null,
        public readonly bool $allSkipped = false,
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'result' => $this->result,
            'skipped' => $this->skipped,
            'errors' => $this->errors,
            'trace' => $this->trace,
            'allSkipped' => $this->allSkipped,
        ];
    }

    /** @return array<string, mixed> */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    public function offsetExists(mixed $offset): bool
    {
        return array_key_exists((string) $offset, $this->toArray());
    }

    public function offsetGet(mixed $offset): mixed
    {
        return $this->toArray()[(string) $offset] ?? null;
    }

    public function offsetSet(mixed $offset, mixed $value): void
    {
        throw new \LogicException('EvaluationResult is immutable.');
    }

    public function offsetUnset(mixed $offset): void
    {
        throw new \LogicException('EvaluationResult is immutable.');
    }
}
