idf_component_register(
    SRCS "main.c" "screen.c" "test_card.c" "media.c" "media_format.c" "gif_decoder.c"
         "scene.c" "scene_format.c"
         "network.c" "improv.c" "web.c" "dns.c" "logbuf.c"
    INCLUDE_DIRS "."
    EMBED_TXTFILES "receiver.html" "setup.html"
)

# These loops run for every pixel of every frame: build them for speed, not size.
set_source_files_properties(scene.c scene_format.c screen.c gif_decoder.c
    PROPERTIES COMPILE_OPTIONS "-O2")
