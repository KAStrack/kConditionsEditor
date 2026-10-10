<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor;

if (!function_exists(__NAMESPACE__ . '\\evaluate')) {
    /**
     * Evaluate a kConditions document against a set of field values.
     *
     * Returns a boolean — unless $hook is supplied, in which case the hook's
     * return value is returned instead. The hook receives the original call's
     * arguments, then the computed boolean, then the detailed result.
     *
     * @param array<string, mixed>|string $document
     * @param array<string, mixed>|object $data
     * @param array<string, mixed> $options
     * @param callable|null $hook fn($document, $data, $options, bool $result, EvaluationResult $details): mixed
     */
    function evaluate(
        array|string $document,
        array|object $data = [],
        array $options = [],
        ?callable $hook = null
    ): mixed {
        $evaluator = new Evaluator($options);
        $details = $evaluator->evaluateDetailed($document, $data);

        if ($hook !== null) {
            return $hook($document, $data, $options, $details->result, $details);
        }

        return $details->result;
    }

    /**
     * Evaluate and always return the detailed result.
     *
     * @param array<string, mixed>|string $document
     * @param array<string, mixed>|object $data
     * @param array<string, mixed> $options
     */
    function evaluateDetailed(array|string $document, array|object $data = [], array $options = []): EvaluationResult
    {
        return (new Evaluator($options))->evaluateDetailed($document, $data);
    }

    /**
     * @param array<string, mixed> $options
     */
    function createEvaluator(array $options = []): Evaluator
    {
        return new Evaluator($options);
    }

    /**
     * Render a document as a SQL boolean expression — the part after WHERE.
     *
     * Returns just the SQL string. Use SqlBuilder directly when you need the
     * bound parameters, the skipped list or the warnings.
     *
     * Building here, from the posted document, is the right path when your
     * endpoint receives a rule rather than SQL.
     *
     * @param array<string, mixed>|string $document
     * @param array<string, mixed> $options
     */
    function toSql(array|string $document, array $options = []): string
    {
        return (new SqlBuilder($options))->build($document)['sql'];
    }

    /**
     * @param array<string, mixed>|string $document
     * @param array<string, mixed> $options
     * @return array{sql: string, params: array<int, mixed>, dialect: string, skipped: array<int, array<string, mixed>>, warnings: array<int, array<string, mixed>>}
     */
    function toSqlDetailed(array|string $document, array $options = []): array
    {
        return (new SqlBuilder($options))->build($document);
    }

    /**
     * Render a document as a sentence — for a confirmation page, an audit log,
     * an email.
     *
     * Options: 'fields' (for labels and choice labels), 'operators' (custom
     * operator labels) and 'emptyText'.
     *
     * @param array<string, mixed>|string|null $document
     * @param array<string, mixed> $options
     */
    function describe(array|string|null $document, array $options = []): string
    {
        return Evaluator::describe($document, $options);
    }

    /**
     * The same rendering as HTML, wrapped in .kcd-* classes.
     *
     * Everything interpolated is escaped, with no way to turn that off: a
     * document is client-supplied input, and so are the field labels and the
     * empty text you pass alongside it.
     *
     * @param array<string, mixed>|string|null $document
     * @param array<string, mixed> $options
     */
    function describeHtml(array|string|null $document, array $options = []): string
    {
        return Evaluator::describeHtml($document, $options);
    }
}
