' 测试组合关键字格式化
sub main()
    dim x, y as integer
    if x > 0 then
        for i = 1 to 10
            y = y + i
        next
    end if
end sub

function calc(byval x as integer) as integer
    while x > 0
        x = x - 1
    wend
    return x
end function

structure point
    x as integer
    y as integer
end structure

select case x
    case 1
        y = 1
    case 2
        y = 2
end select