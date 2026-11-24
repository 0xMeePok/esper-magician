# Each screen has its own picture, sized for it by tools/img2cyd.py --screen.
if(CONFIG_ESPER_BOARD_DEVKIT_1_9)
    set(picture "images/1.9/picture.bin")
else()
    set(picture "images/2.8/picture.bin")
endif()

idf_component_register(
    SRCS "main.c" "picture_player.c" "test_card.c"
    INCLUDE_DIRS "."
    EMBED_FILES "${picture}"
)
