# Held: media privacy line (help, "Privacy" article)

Not live. These lines replace the "Images and videos you make" line in
`docs/gente/help/{en,es,pt}/05-privacy.md` once the first real fal.ai job confirms that fal keeps
no record of the request and deletes its file copy after 1 hour (Gente Cloud commit 6716250c8
sends `X-Fal-Store-IO: 0` and a 1-hour `X-Fal-Object-Lifecycle-Preference`). Swap them together
with the growth agent's `docs/gente/trust-page-media-held.html`.

## en

- **Images and videos you make:** your description goes to our image and video service, fal.ai, to make the file. fal.ai keeps no record of the request, and its copy of the file is deleted after 1 hour. Gente saves the file on your computer; our temporary cloud copy is deleted after 30 days.

## es

- **Imágenes y videos que creas:** tu descripción va a nuestro servicio de imágenes y video, fal.ai, para hacer el archivo. fal.ai no guarda ningún registro de la solicitud, y su copia del archivo se borra después de 1 hora. Gente guarda el archivo en tu computadora; nuestra copia temporal en la nube se borra a los 30 días.

## pt

- **Imagens e vídeos que você cria:** sua descrição vai para o nosso serviço de imagens e vídeos, o fal.ai, para fazer o arquivo. O fal.ai não guarda nenhum registro do pedido, e a cópia do arquivo dele é apagada depois de 1 hora. O Gente salva o arquivo no seu computador; a nossa cópia temporária na nuvem é apagada depois de 30 dias.

