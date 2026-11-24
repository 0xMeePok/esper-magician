idf_component_register(
    SRCS "main.c" "screen.c" "test_card.c" "media.c" "media_format.c" "gif_decoder.c"
         "network.c" "improv.c" "web.c"
    INCLUDE_DIRS "."
    EMBED_TXTFILES "receiver.html"
)
