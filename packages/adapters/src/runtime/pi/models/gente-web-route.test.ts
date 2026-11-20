// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Everyday messages in English, Spanish and Portuguese, and where each should go: the web only
// when it needs fresh facts. "what can you do for me today?" must never search.
import { describe, expect, it } from "vitest";
import { webRoute } from "./gente-web-answer.js";

const CASES: Array<[string, "web" | "model"]> = [
  // English: the model alone
  ["what can you do for me today?", "model"],
  ["hey", "model"],
  ["how are you today?", "model"],
  ["help me plan my day today", "model"],
  ["write a short thank-you note to my landlord", "model"],
  ["translate 'good morning' to French", "model"],
  ["remind me to call mom tonight", "model"],
  ["what's on my calendar today?", "model"],
  ["explain how photosynthesis works", "model"],
  ["give me a recipe for pancakes", "model"],
  ["draft a 2026 budget for my small shop", "model"],
  ["what is the capital of Australia?", "model"],
  ["summarize my notes from yesterday", "model"],
  // English: the web
  ["what's the weather in Austin today?", "web"],
  ["latest news about the Mars mission", "web"],
  ["who won the Lakers game last night?", "web"],
  ["bitcoin price right now", "web"],
  ["search for the best ramen near me", "web"],
  ["what happened in the stock market today?", "web"],
  ["is the Apple store open now?", "web"],
  ["look up the release date of the new Zelda", "web"],
  // Spanish: the model alone
  ["¿qué puedes hacer por mí hoy?", "model"],
  ["hola, ¿cómo estás hoy?", "model"],
  ["ayúdame a organizar mi semana", "model"],
  ["escribe un mensaje de cumpleaños para mi hermana", "model"],
  ["traduce esto al inglés: buenos días", "model"],
  ["recuérdame pagar la renta mañana", "model"],
  ["¿qué tengo en mi agenda hoy?", "model"],
  ["explícame qué es la inflación", "model"],
  ["¿cuál es la capital de Australia?", "model"],
  // Spanish: the web
  ["¿qué clima hace hoy en Madrid?", "web"],
  ["últimas noticias de México", "web"],
  ["¿quién ganó el partido del Real Madrid ayer?", "web"],
  ["precio del dólar hoy", "web"],
  ["busca en internet restaurantes veganos en CDMX", "web"],
  ["¿a qué hora juega México hoy?", "web"],
  // Portuguese: the model alone
  ["o que você pode fazer por mim hoje?", "model"],
  ["oi, como você está hoje?", "model"],
  ["me ajuda a planejar minha semana", "model"],
  ["escreva um e-mail de agradecimento para o meu chefe", "model"],
  ["traduza isso para o inglês: obrigado", "model"],
  ["me lembre de tomar remédio às 8", "model"],
  ["o que é inteligência artificial?", "model"],
  ["qual é a capital da Austrália?", "model"],
  // Portuguese: the web
  ["previsão do tempo em São Paulo hoje", "web"],
  ["últimas notícias do Brasil", "web"],
  ["quem ganhou o jogo do Flamengo ontem?", "web"],
  ["cotação do dólar hoje", "web"],
  ["pesquise na internet o horário do metrô", "web"],
  ["o que aconteceu no mercado hoje?", "web"],
];

describe("which messages go to the web", () => {
  it("has 50 everyday phrases", () => expect(CASES).toHaveLength(50));
  it.each(CASES)("%s → %s", (text, expected) => expect(webRoute(text)).toBe(expected));
});
