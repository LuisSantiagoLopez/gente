// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ASK_TYPED_ANSWER_MAX,
  askQuestions,
  decodeAskAnswers,
  encodeAskAnswers,
  resolveAskChoice,
} from "@rakazo/core";
import { Button, Input } from "@rakazo/ui-web";
import { useState } from "react";
import type { AskBlock } from "./AskCard";
import { OptionRow, optionLetter } from "./OptionRow";

/**
 * Gente: a question card's options, for one question or several. Each question also takes a
 * typed answer ("Something else"). One question sends on the first click; several send together
 * once each has an answer. Once answered, the chosen options stay marked.
 */
export function QuestionOptions({
  block,
  answer,
  disabled,
  pendingAction,
  onSubmit,
}: {
  block: AskBlock;
  /** The answer the card holds once answered. */
  answer: string | undefined;
  disabled: boolean;
  pendingAction: string | null;
  onSubmit: (value: string) => void;
}) {
  const { t } = useLingui();
  const questions = askQuestions(block);
  const several = questions.length > 1;
  const answered = answer !== undefined;
  const recorded = answered
    ? several
      ? (decodeAskAnswers(answer, questions.length) ?? questions.map(() => ""))
      : [answer]
    : undefined;
  const [picks, setPicks] = useState<string[]>(() => questions.map(() => ""));
  const [typing, setTyping] = useState<number | null>(null);
  const [typed, setTyped] = useState<string[]>(() => questions.map(() => ""));
  const setAt = (list: string[], index: number, value: string) =>
    list.map((item, i) => (i === index ? value : item));
  const complete = picks.every((pick) => pick.trim() !== "");

  return (
    <div className="mt-2.5 flex flex-col gap-3" data-testid="question-options">
      {questions.map((question, index) => {
        // A reply typed in the chat box has its own message; the card does not repeat it.
        const typedInChat = answered && Boolean(block.answerMessageId);
        const shown = typedInChat && !several ? "" : (recorded?.[index] ?? picks[index] ?? "");
        const chosen = resolveAskChoice(shown, question.actions);
        const typedShown = shown.trim() !== "" && !chosen;
        const otherOpen = !answered && typing === index;
        return (
          // Questions do not move or repeat, so their place is their key.
          <fieldset key={index} className="min-w-0 space-y-0.5" data-testid="question-field">
            {index > 0 ? (
              <legend className="mb-1 text-body-lg leading-[1.5] text-foreground">
                {question.text}
              </legend>
            ) : null}
            {question.actions.map((action, actionIndex) => (
              <OptionRow
                key={action.id}
                letter={optionLetter(actionIndex)}
                selected={chosen?.id === action.id}
                disabled={answered || disabled}
                onClick={() => {
                  setTyping(null);
                  if (several) setPicks((list) => setAt(list, index, action.id));
                  else onSubmit(action.id);
                }}
              >
                {pendingAction === action.id ? <Trans>Sending…</Trans> : action.label}
              </OptionRow>
            ))}
            <OptionRow
              letter={optionLetter(question.actions.length)}
              selected={typedShown}
              disabled={answered || disabled}
              onClick={() => {
                setTyping(index);
                if (several) setPicks((list) => setAt(list, index, typed[index] ?? ""));
              }}
            >
              {typedShown ? shown : <Trans>Something else</Trans>}
            </OptionRow>
            {otherOpen ? (
              <form
                className="flex items-center gap-2 pt-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = (typed[index] ?? "").trim();
                  if (!value) return;
                  if (several) setPicks((list) => setAt(list, index, value));
                  else onSubmit(value);
                }}
              >
                <Input
                  autoFocus
                  aria-label={t`Your answer`}
                  maxLength={ASK_TYPED_ANSWER_MAX}
                  value={typed[index] ?? ""}
                  disabled={disabled}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTyped((list) => setAt(list, index, value));
                    if (several) setPicks((list) => setAt(list, index, value));
                  }}
                />
                {several ? null : (
                  <Button type="submit" disabled={disabled || !(typed[index] ?? "").trim()}>
                    <Trans>Send</Trans>
                  </Button>
                )}
              </form>
            ) : null}
          </fieldset>
        );
      })}
      {several && !answered ? (
        <Button
          className="w-fit"
          disabled={disabled || !complete}
          onClick={() => onSubmit(encodeAskAnswers(picks))}
        >
          {pendingAction ? <Trans>Sending…</Trans> : <Trans>Send answers</Trans>}
        </Button>
      ) : null}
    </div>
  );
}
